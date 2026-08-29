import { createHash } from "node:crypto";

import { findEvidenceGaps, normalizeGapQueries, selectEvidenceGaps, type EvidenceGap, type GapQueryPlanner } from "@/lib/ai/gap-investigator";
import { normalizeExtractedEvidence, type EvidenceExtractor } from "@/lib/ai/extractor";
import type { ResearchEvidence, ResearchTask } from "@/lib/domain/research";
import { toErrorMessage } from "@/lib/errors";
import type { PageReader } from "@/lib/read/page-reader";
import type { ResearchRepository } from "@/lib/research/repository";
import { getSearchResultCount } from "@/lib/search/factory";
import type { SearchProvider } from "@/lib/search/provider";
import { canonicalizeUrl } from "@/lib/search/url";

export type GapFillOutcome = EvidenceGap & { status: string; detail?: string };
export type GapFillResult = {
  candidateGaps: EvidenceGap[];
  selectedGaps: EvidenceGap[];
  searchAttempts: number;
  readAttempts: number;
  filledGaps: EvidenceGap[];
  remainingGaps: EvidenceGap[];
  outcomes: GapFillOutcome[];
  evidence: ResearchEvidence[];
};

const norm = (value: string) => value.trim().toLocaleLowerCase();
const sameGap = (left: EvidenceGap, right: EvidenceGap) => norm(left.product) === norm(right.product) && norm(left.dimension) === norm(right.dimension);

export async function fillEvidenceGaps(input: {
  repository: ResearchRepository;
  task: ResearchTask;
  runId: string;
  dimensions: string[];
  evidence: ResearchEvidence[];
  queryPlanner: GapQueryPlanner;
  searchProvider: SearchProvider;
  pageReader: PageReader;
  extractor: EvidenceExtractor;
}): Promise<GapFillResult> {
  const candidateGaps = findEvidenceGaps(input.task.competitors, input.dimensions, input.evidence);
  const selectedGaps = selectEvidenceGaps(candidateGaps);
  const outcomes: GapFillOutcome[] = [];
  let searchAttempts = 0;
  let readAttempts = 0;
  let evidence = input.evidence;
  if (!selectedGaps.length) return { candidateGaps, selectedGaps, searchAttempts, readAttempts, filledGaps: [], remainingGaps: [], outcomes, evidence };

  let queries;
  try {
    queries = normalizeGapQueries(await input.queryPlanner.plan({ topic: input.task.topic, focus: input.task.focus, gaps: selectedGaps }), selectedGaps);
  } catch (error) {
    for (const gap of selectedGaps) outcomes.push({ ...gap, status: "query_error", detail: toErrorMessage(error) });
    return { candidateGaps, selectedGaps, searchAttempts, readAttempts, filledGaps: [], remainingGaps: candidateGaps, outcomes, evidence };
  }
  for (const gap of queries.invalid) outcomes.push({ ...gap, status: "invalid_query" });

  for (const planned of queries.valid.slice(0, 3)) {
    try {
      searchAttempts += 1;
      const existing = new Set((await input.repository.listSources(input.task.id, input.runId)).map((source) => source.canonicalUrl));
      const results = await input.searchProvider.search({ query: planned.query, count: getSearchResultCount() });
      let cellReadAttempts = 0;
      let filled = false;
      const failures: string[] = [];
      for (const result of [...results].sort((left, right) => left.rank - right.rank)) {
        if (cellReadAttempts >= 2 || readAttempts >= 6 || filled) break;
        const canonicalUrl = canonicalizeUrl(result.url);
        if (!canonicalUrl || existing.has(canonicalUrl)) continue;
        existing.add(canonicalUrl);
        const sources = await input.repository.saveSources(input.task.id, input.runId, [{ product: planned.product, title: result.title, url: result.url, canonicalUrl, snippet: result.snippet, sourceType: "search_result", isOfficial: false, metadata: { query: planned.query, rank: result.rank, via: "gap_investigator" } }]);
        const source = sources.find((item) => item.canonicalUrl === canonicalUrl);
        if (!source) { failures.push("无法保存来源"); continue; }

        cellReadAttempts += 1;
        readAttempts += 1;
        const read = await input.pageReader.read(source.url);
        if (!read.ok || !read.text.trim()) {
          const reason = read.ok ? "页面正文为空" : read.reason;
          await input.repository.updateSourceFetch(source.id, { fetchStatus: "skipped", fetchError: reason, extractedText: null });
          failures.push(reason);
          continue;
        }
        await input.repository.updateSourceFetch(source.id, { fetchStatus: "ok", extractedText: read.text, fetchError: null, contentHash: createHash("sha256").update(read.text).digest("hex") });
        const readableSource = { ...source, fetchStatus: "ok" as const, extractedText: read.text };
        const raw = await input.extractor.extract({ topic: input.task.topic, competitors: input.task.competitors, focus: input.task.focus, dimensions: input.dimensions, sources: [readableSource] });
        const extracted = normalizeExtractedEvidence(raw, { topic: input.task.topic, competitors: input.task.competitors, focus: input.task.focus, sources: [readableSource] })
          .filter((item) => norm(item.product) === norm(planned.product) && norm(item.dimension) === norm(planned.dimension));
        if (!extracted.length) { failures.push("页面未抽到目标 Evidence"); continue; }
        await input.repository.saveEvidence(input.task.id, extracted);
        evidence = await input.repository.listEvidence(input.task.id, input.runId);
        outcomes.push({ ...planned, status: "filled" });
        filled = true;
      }
      if (!filled) outcomes.push({ ...planned, status: cellReadAttempts ? "read_failed" : "no_new_url", detail: failures.join("；") || undefined });
    } catch (error) {
      outcomes.push({ ...planned, status: "failed", detail: toErrorMessage(error) });
    }
  }
  const remainingGaps = findEvidenceGaps(input.task.competitors, input.dimensions, evidence);
  const filledGaps = selectedGaps.filter((gap) => !remainingGaps.some((remaining) => sameGap(gap, remaining)));
  return { candidateGaps, selectedGaps, searchAttempts, readAttempts, filledGaps, remainingGaps, outcomes, evidence };
}
