import { describe, expect, it } from "vitest";

import type { EvidenceExtractor } from "../../src/lib/ai/extractor";
import type { ResearchAnalysis, ResearchAnalysisInput, ResearchAnalyst } from "../../src/lib/ai/analyst";
import type { ResearchGenerator } from "../../src/lib/ai/generator";
import type { ResearchPlanner } from "../../src/lib/ai/planner";
import type { ResearchReviewer } from "../../src/lib/ai/reviewer";
import { DemoGapQueryPlanner } from "../../src/lib/ai/demo-gap-query-planner";
import type { ResearchInvestigator } from "../../src/lib/ai/investigator";
import type { ResearchDraft } from "../../src/lib/domain/research";
import type { PageReadResult, PageReader } from "../../src/lib/read/page-reader";
import { MemoryResearchRepository } from "../../src/lib/research/memory-repository";
import { runClaimedWorkflow } from "../../src/lib/research/workflow";
import type { SearchProvider, SearchResult } from "../../src/lib/search/provider";

const completeDraft: ResearchDraft = {
  title: "AI Coding 产品竞品分析",
  executiveSummary: "三款产品以不同入口服务软件开发流程。",
  products: [
    {
      name: "Cursor",
      positioning: "AI 原生编辑器",
      strengths: ["编辑器体验完整"],
      limitations: ["V1 未接入实时来源"],
      bestFor: "偏好图形化 IDE 的开发者",
    },
    {
      name: "Claude Code",
      positioning: "终端编码代理",
      strengths: ["终端工作流自然"],
      limitations: ["V1 未接入实时来源"],
      bestFor: "CLI 用户",
    },
    {
      name: "Codex",
      positioning: "任务式编码代理",
      strengths: ["便于委派任务"],
      limitations: ["V1 未接入实时来源"],
      bestFor: "需要异步委派的团队",
    },
  ],
  dimensions: [
    {
      name: "交互形态",
      summary: "IDE、CLI 和任务委派代表三种不同入口。",
      leaders: ["Cursor", "Claude Code", "Codex"],
    },
  ],
  conclusion: "选择应匹配团队已有的开发工作流。",
  limitations: ["V1 结果没有公开资料支撑，仅用于验证系统流程。"],
};

async function createClaimedRun(repository: MemoryResearchRepository) {
  const task = await repository.createTask({
    topic: "AI Coding 产品分析",
    competitors: ["Cursor", "Claude Code", "Codex"],
  });
  const run = await repository.claimNextRun("test-worker");
  if (!run) throw new Error("Expected a queued run");
  return { task, run };
}

describe("runClaimedWorkflow", () => {
  it("persists a report and completes every state on success", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const generator: ResearchGenerator = {
      name: "test",
      generate: async () => completeDraft,
    };

    const report = await runClaimedWorkflow(repository, generator, run);
    const detail = await repository.getTaskDetail(task.id);

    expect(report.title).toBe(completeDraft.title);
    expect(detail?.task.status).toBe("completed");
    expect(detail?.steps).toHaveLength(1);
    expect(detail?.steps[0].status).toBe("completed");
    expect(detail?.report?.content).toContain("## Executive Summary");
  });

  it("keeps evidence isolated when the same task is run again", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const dimensions = ["产品定位", "定价", "生态"];
    const planner: ResearchPlanner = { name: "test", plan: async ({ competitors }) => ({ dimensions, searchQueries: competitors.map((product) => ({ product, query: `${product} base` })), rationale: "test" }) };
    const execute = (claimed: typeof run, suffix: string) => runClaimedWorkflow(repository, { name: "test", generate: async () => completeDraft }, claimed, recordingSearchProvider([], (query, index) => [searchHit(`https://example.com/${suffix}-${index}`, query)]), recordingPageReader([], okPage), recordingExtractor([]), undefined, undefined, planner, { name: "test", analyze: async (analysisInput) => gapAnalysis(analysisInput) });
    await execute(run, "first");
    await repository.enqueueTask(task.id);
    const second = await repository.claimNextRun("second-worker");
    if (!second) throw new Error("missing second run");
    await execute(second, "second");
    expect(await repository.listEvidence(task.id, run.id)).toHaveLength(3);
    expect(await repository.listEvidence(task.id, second.id)).toHaveLength(3);
  });

  it("marks the step and task as failed when the provider throws", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const generator: ResearchGenerator = {
      name: "failing-test",
      generate: async () => {
        throw new Error("provider unavailable");
      },
    };

    await expect(runClaimedWorkflow(repository, generator, run)).rejects.toThrow(
      "provider unavailable",
    );
    const detail = await repository.getTaskDetail(task.id);
    expect(detail?.task.status).toBe("failed");
    expect(detail?.task.error).toContain("provider unavailable");
    expect(detail?.steps[0].status).toBe("failed");
  });

  it("rejects a draft that omits a requested competitor", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const generator: ResearchGenerator = {
      name: "incomplete-test",
      generate: async () => ({
        ...completeDraft,
        products: completeDraft.products.slice(0, 2),
      }),
    };

    await expect(runClaimedWorkflow(repository, generator, run)).rejects.toThrow(
      "竞品覆盖不完整",
    );
    expect((await repository.getTask(task.id))?.status).toBe("failed");
  });

  it("searches, reads pages, and extracts evidence before generating when search is enabled", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const events: string[] = [];
    const searchProvider = recordingSearchProvider(events, (query, index) => [
      searchHit(`https://example.com/${index}`, query),
    ]);
    const pageReader = recordingPageReader(events, (url) => okPage(url));
    const dimensions = ["产品定位", "定价", "集成生态"];
    const extractor = recordingExtractor(events, (input) => {
      expect(input.dimensions).toEqual(dimensions);
    });
    const planner: ResearchPlanner = {
      name: "test-planner",
      plan: async ({ competitors }) => ({
        dimensions,
        searchQueries: competitors.map((product) => ({
          product,
          query: `${product} custom research query`,
        })),
        rationale: "测试动态搜索词。",
      }),
    };
    const analyst: ResearchAnalyst = {
      name: "test-analyst",
      analyze: async (input) => {
        events.push("analyze");
        return gapAnalysis(input);
      },
    };
    const generator = recordingGenerator(events, (input) => {
      expect(input.sources?.map((source) => source.canonicalUrl)).toEqual([
        "https://example.com/1",
        "https://example.com/2",
        "https://example.com/3",
      ]);
      expect(input.evidence?.map((item) => item.product)).toEqual(["Cursor", "Claude Code", "Codex"]);
      expect(input.dimensions).toEqual(dimensions);
      expect(input.analysis?.dimensions.map((item) => item.dimension)).toEqual(dimensions);
      return completeDraft;
    });

    await runClaimedWorkflow(
      repository,
      generator,
      run,
      searchProvider,
      pageReader,
      extractor,
      undefined,
      undefined,
      planner,
      analyst,
    );
    const detail = await repository.getTaskDetail(task.id);

    expect(events).toEqual([
      "search:Cursor custom research query",
      "search:Claude Code custom research query",
      "search:Codex custom research query",
      "read:https://example.com/1",
      "read:https://example.com/2",
      "read:https://example.com/3",
      "extract",
      "analyze",
      "generate",
    ]);
    expect(searchProvider.counts).toEqual([5, 5, 5]);
    expect(detail?.steps.map((step) => [step.stepType, step.status])).toEqual([
      ["planning", "completed"],
      ["researching", "completed"],
      ["extracting", "completed"],
      ["analyzing", "completed"],
      ["generating", "completed"],
    ]);
    expect(detail?.sourceCount).toBe(3);
    expect(detail?.report?.content).toContain("## 资料索引");
    expect(detail?.report?.content).toContain("[S1]");
    expect(detail?.report?.content).toContain("## 证据摘录");
    expect(detail?.report?.content).toContain("[E1]");
  });

  it("does not read pages when search is disabled", async () => {
    const repository = new MemoryResearchRepository();
    const { run } = await createClaimedRun(repository);
    const events: string[] = [];
    const planner: ResearchPlanner = {
      name: "must-not-run",
      plan: async () => {
        events.push("plan");
        throw new Error("planner should not run");
      },
    };
    await runClaimedWorkflow(
      repository,
      recordingGenerator(events, () => completeDraft),
      run,
      { name: "disabled", search: async () => [] },
      recordingPageReader(events, (url) => okPage(url)),
      recordingExtractor(events),
      undefined,
      undefined,
      planner,
    );
    expect(events).toEqual(["generate"]);
  });

  it("runs bounded gap filling after extraction and never calls the legacy investigator", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const events: string[] = [];
    const investigator: ResearchInvestigator = {
      name: "must-not-run",
      investigate: async () => { throw new Error("legacy investigator was called"); },
    };
    const dimensions = ["产品定位", "定价", "生态"];
    const planner: ResearchPlanner = { name: "test", plan: async ({ competitors }) => ({ dimensions, searchQueries: competitors.map((product) => ({ product, query: `${product} base` })), rationale: "test" }) };
    const searchProvider = recordingSearchProvider(events, (query, index) => [searchHit(`https://example.com/${index}-${encodeURIComponent(query)}`, query)]);
    await runClaimedWorkflow(repository, recordingGenerator(events, () => completeDraft), run, searchProvider, recordingPageReader(events, okPage), recordingExtractor(events), investigator, undefined, planner, { name: "test", analyze: async (input) => gapAnalysis(input) }, new DemoGapQueryPlanner());
    const detail = await repository.getTaskDetail(task.id);
    const gapStep = detail?.steps.find((step) => step.stepType === "gap_filling");
    expect(gapStep?.status).toBe("completed");
    expect(gapStep?.output).toMatchObject({ searchAttempts: 3, readAttempts: 3 });
    expect(searchProvider.counts).toHaveLength(6);
  });

  it("reads at most two sources per competitor and skips a failed page", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const events: string[] = [];
    const searchProvider: SearchProvider = {
      name: "brave",
      async search({ query }) {
        const product = query.split(" ")[0] ?? "product";
        return [
          searchHit(`https://example.com/${product}/a`, query, 1),
          searchHit(`https://example.com/${product}/b`, query, 2),
          searchHit(`https://example.com/${product}/c`, query, 3),
        ];
      },
    };
    const pageReader = recordingPageReader(events, (url) => {
      if (url.endsWith("/a")) return { ok: false, url, reason: "读取页面超时（8000ms）" };
      return okPage(url);
    });

    await runClaimedWorkflow(
      repository,
      recordingGenerator([], () => completeDraft),
      run,
      searchProvider,
      pageReader,
      recordingExtractor(events),
    );

    const reads = events.filter((event) => event.startsWith("read:"));
    expect(reads).toHaveLength(6);
    expect(reads.some((event) => event.endsWith("/c"))).toBe(false);
    expect(events).toContain("extract");
    const sources = await repository.listSources(task.id, run.id);
    expect(sources.filter((source) => source.fetchStatus === "skipped")).toHaveLength(3);
    expect(sources.filter((source) => source.fetchStatus === "ok")).toHaveLength(3);
  });

  it("fails the run when every page read fails", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    let generated = false;
    await expect(
      runClaimedWorkflow(
        repository,
        {
          name: "test",
          generate: async () => {
            generated = true;
            return completeDraft;
          },
        },
        run,
        recordingSearchProvider([], (query, index) => [searchHit(`https://example.com/${index}`, query)]),
        {
          name: "test",
          async read(url) {
            return { ok: false, url, reason: "拒绝访问私网或本机地址" };
          },
        },
        recordingExtractor([]),
      ),
    ).rejects.toThrow("全部无法读取");
    expect(generated).toBe(false);
    expect((await repository.getTask(task.id))?.status).toBe("failed");
  });

  it("fails the run when extraction returns no evidence", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const extractor: EvidenceExtractor = {
      name: "empty",
      extract: async () => [],
    };
    await expect(
      runClaimedWorkflow(
        repository,
        recordingGenerator([], () => completeDraft),
        run,
        recordingSearchProvider([], (query, index) => [searchHit(`https://example.com/${index}`, query)]),
        recordingPageReader([], (url) => okPage(url)),
        extractor,
      ),
    ).rejects.toThrow("证据抽取结果无效");
    expect((await repository.getTask(task.id))?.status).toBe("failed");
  });

  it("keeps one source when competitors return the same canonical URL", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const searchProvider: SearchProvider = {
      name: "brave",
      async search({ query }) {
        return [
          searchHit("https://Example.com/shared/?utm_source=ad#top", query),
          searchHit("https://example.com/shared/", query),
        ];
      },
    };

    await runClaimedWorkflow(
      repository,
      recordingGenerator([], () => completeDraft),
      run,
      searchProvider,
      recordingPageReader([], (url) => okPage(url)),
      recordingExtractor([]),
    );

    const sources = await repository.listSources(task.id, run.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.canonicalUrl).toBe("https://example.com/shared");
  });

  it("fails the run when search throws before generation", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    let generated = false;
    const searchProvider: SearchProvider = {
      name: "brave",
      async search() {
        throw new Error("Brave Search 请求失败（429）");
      },
    };
    const generator: ResearchGenerator = {
      name: "test",
      generate: async () => {
        generated = true;
        return completeDraft;
      },
    };

    await expect(runClaimedWorkflow(repository, generator, run, searchProvider)).rejects.toThrow(
      "Brave Search 请求失败（429）",
    );
    const detail = await repository.getTaskDetail(task.id);
    expect(generated).toBe(false);
    expect(detail?.task.status).toBe("failed");
    expect(detail?.sourceCount).toBe(0);
    expect(detail?.steps.map((step) => [step.stepType, step.status])).toEqual([
      ["planning", "completed"],
      ["researching", "failed"],
    ]);
  });

  it("fails in planning without starting research when the planner throws", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const planner: ResearchPlanner = {
      name: "failing-planner",
      plan: async () => {
        throw new Error("规划输出无效");
      },
    };

    await expect(
      runClaimedWorkflow(
        repository,
        recordingGenerator([], () => completeDraft),
        run,
        recordingSearchProvider([], () => []),
        undefined,
        undefined,
        undefined,
        undefined,
        planner,
      ),
    ).rejects.toThrow("规划输出无效");

    const detail = await repository.getTaskDetail(task.id);
    expect(detail?.task.status).toBe("failed");
    expect(detail?.steps.map((step) => [step.stepType, step.status])).toEqual([
      ["planning", "failed"],
    ]);
  });

  it("fails in analyzing without starting generation when the analyst throws", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    let generated = false;
    const analyst: ResearchAnalyst = {
      name: "failing-analyst",
      analyze: async () => {
        throw new Error("横向分析输出无效");
      },
    };

    await expect(
      runClaimedWorkflow(
        repository,
        {
          name: "test",
          generate: async () => {
            generated = true;
            return completeDraft;
          },
        },
        run,
        recordingSearchProvider([], (query, index) => [searchHit(`https://example.com/${index}`, query)]),
        recordingPageReader([], (url) => okPage(url)),
        recordingExtractor([]),
        undefined,
        undefined,
        undefined,
        analyst,
      ),
    ).rejects.toThrow("横向分析输出无效");

    const detail = await repository.getTaskDetail(task.id);
    expect(generated).toBe(false);
    expect(detail?.steps.map((step) => [step.stepType, step.status])).toEqual([
      ["planning", "completed"],
      ["researching", "completed"],
      ["extracting", "completed"],
      ["analyzing", "failed"],
    ]);
  });

  it("passes the same analysis to generator and reviewer", async () => {
    const repository = new MemoryResearchRepository();
    const { run } = await createClaimedRun(repository);
    let generatedAnalysis: ResearchAnalysis | undefined;
    let reviewedAnalysis: ResearchAnalysis | undefined;
    const analyst: ResearchAnalyst = {
      name: "test-analyst",
      analyze: async (input) => gapAnalysis(input),
    };
    const reviewer: ResearchReviewer = {
      name: "test-reviewer",
      review: async (input) => {
        reviewedAnalysis = input.analysis;
        return { verdict: "pass", notes: [] };
      },
    };

    await runClaimedWorkflow(
      repository,
      recordingGenerator([], (input) => {
        generatedAnalysis = input.analysis;
        return completeDraft;
      }),
      run,
      recordingSearchProvider([], (query, index) => [searchHit(`https://example.com/${index}`, query)]),
      recordingPageReader([], (url) => okPage(url)),
      recordingExtractor([]),
      undefined,
      reviewer,
      undefined,
      analyst,
    );

    expect(generatedAnalysis).toBeDefined();
    expect(reviewedAnalysis).toBe(generatedAnalysis);
  });

  it("passes review and stores passed status", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const reviewer: ResearchReviewer = {
      name: "test",
      review: async () => ({ verdict: "pass", notes: ["覆盖完整"] }),
    };
    const report = await runClaimedWorkflow(
      repository,
      recordingGenerator([], () => completeDraft),
      run,
      undefined,
      undefined,
      undefined,
      undefined,
      reviewer,
    );
    const detail = await repository.getTaskDetail(task.id);
    expect(report.reviewStatus).toBe("passed");
    expect(detail?.steps.map((step) => [step.stepType, step.status])).toEqual([
      ["generating", "completed"],
      ["reviewing", "completed"],
    ]);
    expect(detail?.steps.find((step) => step.stepType === "reviewing")?.output).toEqual({
      verdict: "pass",
      notes: ["覆盖完整"],
      revisions: 0,
    });
  });

  it("stores the final review notes when revisions remain requested", async () => {
    const repository = new MemoryResearchRepository();
    const { task, run } = await createClaimedRun(repository);
    const reviewer: ResearchReviewer = {
      name: "test",
      review: async () => ({ verdict: "revise", notes: ["价格信息仍需人工确认"] }),
    };

    const report = await runClaimedWorkflow(
      repository,
      recordingGenerator([], () => completeDraft),
      run,
      undefined,
      undefined,
      undefined,
      undefined,
      reviewer,
    );
    const detail = await repository.getTaskDetail(task.id);

    expect(report.reviewStatus).toBe("revision_requested");
    expect(detail?.steps.find((step) => step.stepType === "reviewing")?.output).toEqual({
      verdict: "revise",
      notes: ["价格信息仍需人工确认"],
      revisions: 1,
    });
  });

  it("regenerates once when review requests a revision", async () => {
    const repository = new MemoryResearchRepository();
    const { run } = await createClaimedRun(repository);
    const events: string[] = [];
    let reviews = 0;
    const reviewer: ResearchReviewer = {
      name: "test",
      review: async () => {
        reviews += 1;
        if (reviews === 1) return { verdict: "revise", notes: ["补充局限说明"] };
        return { verdict: "pass", notes: [] };
      },
    };
    const report = await runClaimedWorkflow(
      repository,
      recordingGenerator(events, () => completeDraft),
      run,
      undefined,
      undefined,
      undefined,
      undefined,
      reviewer,
    );
    expect(events).toEqual(["generate", "generate"]);
    expect(report.reviewStatus).toBe("passed");
  });
});

function searchHit(url: string, query: string, rank = 1): SearchResult {
  return {
    title: `${query} result`,
    url,
    snippet: `${query} snippet`,
    rank,
    canonicalUrl: url,
  };
}

function recordingSearchProvider(
  events: string[],
  resultsFor: (query: string, index: number) => SearchResult[],
): SearchProvider & { counts: number[] } {
  const counts: number[] = [];
  return {
    name: "brave",
    counts,
    async search({ query, count }) {
      events.push(`search:${query}`);
      counts.push(count ?? -1);
      return resultsFor(query, events.filter((event) => event.startsWith("search:")).length);
    },
  };
}

function recordingGenerator(
  events: string[],
  draftFor: (input: Parameters<ResearchGenerator["generate"]>[0]) => ResearchDraft,
): ResearchGenerator {
  return {
    name: "test",
    generate: async (input) => {
      events.push("generate");
      return draftFor(input);
    },
  };
}

function okPage(url: string): PageReadResult {
  return {
    ok: true,
    url,
    finalUrl: url,
    title: "Page",
    text: `Official overview for ${url}`,
    contentType: "text/html",
    status: 200,
  };
}

function recordingPageReader(
  events: string[],
  resultFor: (url: string) => PageReadResult,
): PageReader {
  return {
    name: "test",
    async read(url) {
      events.push(`read:${url}`);
      return resultFor(url);
    },
  };
}

function recordingExtractor(
  events: string[],
  inspect?: (input: Parameters<EvidenceExtractor["extract"]>[0]) => void,
): EvidenceExtractor {
  return {
    name: "test",
    async extract(input) {
      events.push("extract");
      inspect?.(input);
      return input.sources
        .filter((source) => source.extractedText)
        .map((source) => ({
          sourceId: source.id,
          product: source.product,
          dimension: "产品概述",
          value: source.extractedText,
          evidenceText: source.extractedText ?? source.snippet,
          confidence: 0.6,
        }));
    },
  };
}

function gapAnalysis(input: ResearchAnalysisInput): ResearchAnalysis {
  return {
    dimensions: input.dimensions.map((dimension) => ({
      dimension,
      summary: `${dimension} 的现有 Evidence 覆盖不足。`,
      productFindings: input.competitors.map((product) => ({
        product,
        finding: `${product} 在该维度资料不足。`,
        evidenceIds: [],
      })),
      leaders: [],
      evidenceIds: [],
      gaps: input.competitors.map((product) => ({ product, reason: "资料不足。" })),
    })),
    overallSummary: "现有 Evidence 不足，未推断额外事实。",
  };
}
