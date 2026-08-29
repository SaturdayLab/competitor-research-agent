import { createHash } from "node:crypto";
import { z } from "zod";

import { DemoEvidenceExtractor } from "@/lib/ai/demo-extractor";
import { DemoResearchAnalyst } from "@/lib/ai/demo-analyst";
import {
  validateResearchAnalysis,
  type ResearchAnalysis,
  type ResearchAnalyst,
} from "@/lib/ai/analyst";
import { normalizeExtractedEvidence, type EvidenceExtractor } from "@/lib/ai/extractor";
import { DisabledGapQueryPlanner, findEvidenceGaps, type GapQueryPlanner } from "@/lib/ai/gap-investigator";
import type { ResearchGenerator } from "@/lib/ai/generator";
import { DisabledResearchInvestigator, type ResearchInvestigator } from "@/lib/ai/investigator";
import {
  assertResearchPlanCoverage,
  DisabledResearchPlanner,
  ResearchPlanSchema,
  type PlannedSearchQuery,
  type ResearchPlan,
  type ResearchPlanner,
} from "@/lib/ai/planner";
import {
  DisabledResearchReviewer,
  getReviewMaxRevisions,
  ReviewResultSchema,
  type ResearchReviewer,
} from "@/lib/ai/reviewer";
import {
  ResearchDraftSchema,
  type ResearchEvidence,
  type ResearchReport,
  type ResearchSource,
  type ResearchTask,
  type WorkflowRun,
} from "@/lib/domain/research";
import { toErrorMessage } from "@/lib/errors";
import { DisabledPageReader, type PageReader } from "@/lib/read/page-reader";
import { renderResearchMarkdown } from "@/lib/research/markdown";
import { fillEvidenceGaps } from "@/lib/research/gap-filling";
import type { ResearchRepository, SaveResearchSourceInput } from "@/lib/research/repository";
import { getSearchResultCount } from "@/lib/search/factory";
import { DisabledSearchProvider, type SearchProvider } from "@/lib/search/provider";
import { canonicalizeUrl } from "@/lib/search/url";

const MAX_COMPETITOR_SEARCHES = 6;
const PAGE_READ_PER_PRODUCT = 2;

const productNamesSchema = z.object({
  products: z.array(z.object({ name: z.string() })),
});

function normalizeProductName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertCompetitorCoverage(rawDraft: unknown, competitors: string[]): void {
  const result = productNamesSchema.safeParse(rawDraft);
  if (!result.success) return;

  const expected = new Set(competitors.map(normalizeProductName));
  const actual = new Set(result.data.products.map((product) => normalizeProductName(product.name)));
  const complete =
    expected.size === actual.size && [...expected].every((competitor) => actual.has(competitor));

  if (!complete) {
    throw new Error("模型输出的竞品覆盖不完整，已拒绝保存报告");
  }
}

function selectSourcesToRead(sources: ResearchSource[]): ResearchSource[] {
  const counts = new Map<string, number>();
  const selected: ResearchSource[] = [];
  for (const source of sources) {
    const used = counts.get(source.product) ?? 0;
    if (used >= PAGE_READ_PER_PRODUCT) continue;
    counts.set(source.product, used + 1);
    selected.push(source);
  }
  return selected;
}

function summarizeSkipReasons(reasons: string[]): string {
  let blocked = 0;
  let timedOut = 0;
  let other = 0;
  for (const reason of reasons) {
    if (/私网|本机|安全|拒绝访问/.test(reason)) blocked += 1;
    else if (/超时/.test(reason)) timedOut += 1;
    else other += 1;
  }
  const parts: string[] = [];
  if (blocked) parts.push(`${blocked} 个地址被安全策略拒绝`);
  if (timedOut) parts.push(`${timedOut} 个超时`);
  if (other) parts.push(`${other} 个读取失败`);
  return parts.join("，") || "读取失败";
}

async function collectAndSaveSources(
  repository: ResearchRepository,
  searchProvider: SearchProvider,
  task: ResearchTask,
  runId: string,
  searchQueries: PlannedSearchQuery[],
): Promise<ResearchSource[]> {
  const count = getSearchResultCount();
  const seen = new Set<string>();
  const pending: SaveResearchSourceInput[] = [];

  for (const planned of searchQueries.slice(0, MAX_COMPETITOR_SEARCHES)) {
    const { product, query } = planned;
    const results = await searchProvider.search({ query, count });
    for (const result of results) {
      const canonicalUrl = canonicalizeUrl(result.url);
      if (!canonicalUrl || seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      pending.push({
        product,
        title: result.title,
        url: result.url,
        canonicalUrl,
        snippet: result.snippet,
        sourceType: "search_result",
        isOfficial: false,
        metadata: { query, rank: result.rank },
      });
    }
  }

  if (pending.length === 0) return [];
  return repository.saveSources(task.id, runId, pending);
}

async function extractEvidenceFromSources(
  repository: ResearchRepository,
  pageReader: PageReader,
  extractor: EvidenceExtractor,
  task: ResearchTask,
  runId: string,
  sources: ResearchSource[],
  dimensions?: string[],
): Promise<ResearchEvidence[]> {
  const selected = selectSourcesToRead(sources);
  if (selected.length === 0) throw new Error("没有可读取的来源页面");

  const skipReasons: string[] = [];
  let successCount = 0;

  for (const source of selected) {
    if (source.fetchStatus === "ok" && source.extractedText?.trim()) {
      successCount += 1;
      continue;
    }
    const result = await pageReader.read(source.url);
    if (!result.ok) {
      skipReasons.push(result.reason);
      await repository.updateSourceFetch(source.id, {
        fetchStatus: "skipped",
        fetchError: result.reason,
        extractedText: null,
      });
      continue;
    }
    successCount += 1;
    await repository.updateSourceFetch(source.id, {
      fetchStatus: "ok",
      extractedText: result.text,
      fetchError: null,
      contentHash: hashText(result.text),
    });
  }

  if (successCount === 0) {
    throw new Error(`${selected.length} 个页面全部无法读取（${summarizeSkipReasons(skipReasons)}）`);
  }

  const readable = (await repository.listSources(task.id, runId)).filter(
    (source) => source.fetchStatus === "ok" && source.extractedText?.trim(),
  );
  const raw = await extractor.extract({
    topic: task.topic,
    competitors: task.competitors,
    focus: task.focus,
    dimensions,
    sources: readable,
  });
  const extracted = normalizeExtractedEvidence(raw, {
    topic: task.topic,
    competitors: task.competitors,
    focus: task.focus,
    sources: readable,
  });
  await repository.saveEvidence(task.id, extracted);
  return repository.listEvidence(task.id, runId);
}

export async function runClaimedWorkflow(
  repository: ResearchRepository,
  generator: ResearchGenerator,
  run: WorkflowRun,
  searchProvider: SearchProvider = new DisabledSearchProvider(),
  pageReader: PageReader = new DisabledPageReader(),
  extractor: EvidenceExtractor = new DemoEvidenceExtractor(),
  investigator: ResearchInvestigator = new DisabledResearchInvestigator(),
  reviewer: ResearchReviewer = new DisabledResearchReviewer(),
  planner: ResearchPlanner = new DisabledResearchPlanner(),
  analyst: ResearchAnalyst = new DemoResearchAnalyst(),
  gapQueryPlanner: GapQueryPlanner = new DisabledGapQueryPlanner(),
): Promise<ResearchReport> {
  void investigator; // kept in the public signature while the pre-extraction investigator is frozen
  let stepId: string | null = null;

  try {
    if (run.status !== "running") throw new Error("只能执行已领取且处于 running 状态的工作流");
    const task = await repository.getTask(run.taskId);
    if (!task) throw new Error("工作流对应的调研任务不存在");

    let sources: ResearchSource[] = [];
    let evidence: ResearchEvidence[] = [];
    let plan: ResearchPlan | null = null;
    let analysis: ResearchAnalysis | null = null;
    if (searchProvider.name !== "disabled") {
      const planningStep = await repository.beginStep(run.id, task.id, "planning", {
        topic: task.topic,
        competitors: task.competitors,
        focus: task.focus,
        provider: planner.name,
      });
      stepId = planningStep.id;
      plan = ResearchPlanSchema.parse(
        await planner.plan({ topic: task.topic, competitors: task.competitors, focus: task.focus }),
      );
      assertResearchPlanCoverage(plan, task);
      await repository.completeStep(planningStep.id, plan);

      const researchStep = await repository.beginStep(run.id, task.id, "researching", {
        topic: task.topic,
        competitors: task.competitors,
        provider: searchProvider.name,
        queries: plan.searchQueries,
      });
      stepId = researchStep.id;
      sources = await collectAndSaveSources(
        repository,
        searchProvider,
        task,
        run.id,
        plan.searchQueries,
      );
      await repository.completeStep(researchStep.id, {
        sourceCount: sources.length,
        provider: searchProvider.name,
        investigator: "disabled_for_gap_filling",
        toolCalls: [],
      });

      const extractStep = await repository.beginStep(run.id, task.id, "extracting", {
        sourceIds: selectSourcesToRead(sources).map((source) => source.id),
        reader: pageReader.name,
        extractor: extractor.name,
      });
      stepId = extractStep.id;
      evidence = await extractEvidenceFromSources(
        repository,
        pageReader,
        extractor,
        task,
        run.id,
        sources,
        plan.dimensions,
      );
      sources = await repository.listSources(task.id, run.id);
      await repository.completeStep(extractStep.id, {
        attempted: selectSourcesToRead(sources).length,
        fetched: sources.filter((source) => source.fetchStatus === "ok").length,
        skipped: sources.filter((source) => source.fetchStatus === "skipped").length,
        evidenceCount: evidence.length,
      });

      const candidateGaps = findEvidenceGaps(task.competitors, plan.dimensions, evidence);
      if (candidateGaps.length > 0 && gapQueryPlanner.name !== "disabled") {
        const gapStep = await repository.beginStep(run.id, task.id, "gap_filling", {
          candidateGaps,
          provider: gapQueryPlanner.name,
          maxSearches: 3,
          maxReads: 3,
        });
        stepId = gapStep.id;
        const gapResult = await fillEvidenceGaps({ repository, task, runId: run.id, dimensions: plan.dimensions, evidence, queryPlanner: gapQueryPlanner, searchProvider, pageReader, extractor });
        evidence = gapResult.evidence;
        sources = await repository.listSources(task.id, run.id);
        await repository.completeStep(gapStep.id, {
          candidateGaps: gapResult.candidateGaps,
          selectedGaps: gapResult.selectedGaps,
          searchAttempts: gapResult.searchAttempts,
          readAttempts: gapResult.readAttempts,
          filledGaps: gapResult.filledGaps,
          remainingGaps: gapResult.remainingGaps,
          outcomes: gapResult.outcomes,
        });
      }

      const analysisStep = await repository.beginStep(run.id, task.id, "analyzing", {
        dimensions: plan.dimensions,
        evidenceCount: evidence.length,
        provider: analyst.name,
      });
      stepId = analysisStep.id;
      analysis = validateResearchAnalysis(
        await analyst.analyze({
          topic: task.topic,
          competitors: task.competitors,
          focus: task.focus,
          dimensions: plan.dimensions,
          sources,
          evidence,
        }),
        {
          topic: task.topic,
          competitors: task.competitors,
          focus: task.focus,
          dimensions: plan.dimensions,
          sources,
          evidence,
        },
      );
      await repository.completeStep(analysisStep.id, analysis);
    }

    const step = await repository.beginStep(run.id, task.id, "generating", {
      topic: task.topic,
      competitors: task.competitors,
      focus: task.focus,
      provider: generator.name,
      sourceCount: sources.length,
      evidenceCount: evidence.length,
    });
    stepId = step.id;

    const generationInput = {
      topic: task.topic,
      competitors: task.competitors,
      focus: task.focus,
      sources,
      evidence,
      dimensions: plan?.dimensions,
      analysis: analysis ?? undefined,
    };
    const rawDraft = await generator.generate(generationInput);
    assertCompetitorCoverage(rawDraft, task.competitors);
    let draft = ResearchDraftSchema.parse(rawDraft);
    let markdown = renderResearchMarkdown(draft, sources, evidence);
    let reviewStatus: "not_reviewed" | "passed" | "revision_requested" = "not_reviewed";
    let finalStepOutput: unknown = draft;

    if (reviewer.name !== "disabled") {
      await repository.completeStep(step.id, {
        provider: generator.name,
        sourceCount: sources.length,
        evidenceCount: evidence.length,
      });
      const reviewStep = await repository.beginStep(run.id, task.id, "reviewing", {
        provider: reviewer.name,
      });
      stepId = reviewStep.id;
      const maxRevisions = getReviewMaxRevisions();
      let revisions = 0;
      let lastReview: { verdict: string; notes: string[] } = { verdict: "pass", notes: [] };
      while (true) {
        lastReview = ReviewResultSchema.parse(
          await reviewer.review({
            task,
            draft,
            sources,
            evidence,
            dimensions: plan?.dimensions,
            analysis: analysis ?? undefined,
          }),
        );
        if (lastReview.verdict === "pass") {
          reviewStatus = "passed";
          break;
        }
        if (revisions >= maxRevisions) {
          reviewStatus = "revision_requested";
          break;
        }
        revisions += 1;
        const revisionStep = await repository.beginStep(run.id, task.id, "generating", {
          provider: generator.name,
          revision: revisions,
          notes: lastReview.notes,
        });
        const revised = await generator.generate({
          ...generationInput,
          revisionNotes: lastReview.notes,
        });
        assertCompetitorCoverage(revised, task.competitors);
        draft = ResearchDraftSchema.parse(revised);
        markdown = renderResearchMarkdown(draft, sources, evidence);
        await repository.completeStep(revisionStep.id, { revision: revisions });
      }
      finalStepOutput = {
        verdict: lastReview.verdict,
        notes: lastReview.notes,
        revisions,
      };
      stepId = reviewStep.id;
    }

    return await repository.completeWorkflow({
      taskId: task.id,
      runId: run.id,
      stepId,
      draft,
      markdown,
      reviewStatus,
      finalStepOutput,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    try {
      await repository.failWorkflow({
        taskId: run.taskId,
        runId: run.id,
        stepId,
        error: message,
      });
    } catch (stateError) {
      throw new Error(`${message}；同时记录失败状态时出错：${toErrorMessage(stateError)}`);
    }
    throw new Error(message, { cause: error });
  }
}
