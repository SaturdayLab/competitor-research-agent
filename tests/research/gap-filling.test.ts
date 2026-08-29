import { describe, expect, it, vi } from "vitest";
import { DemoGapQueryPlanner } from "@/lib/ai/demo-gap-query-planner";
import type { EvidenceExtractor } from "@/lib/ai/extractor";
import { MemoryResearchRepository } from "@/lib/research/memory-repository";
import { fillEvidenceGaps } from "@/lib/research/gap-filling";

async function setup() {
  const repository = new MemoryResearchRepository();
  const task = await repository.createTask({ topic: "协同办公", competitors: ["A", "B", "C"] });
  const run = await repository.claimNextRun("worker");
  if (!run) throw new Error("missing run");
  return { repository, task, run };
}

describe("fillEvidenceGaps", () => {
  it("performs at most one search and one read per selected gap", async () => {
    const { repository, task, run } = await setup();
    const search = vi.fn(async ({ query }: { query: string }) => [{ title: query, url: `https://example.com/${encodeURIComponent(query)}`, canonicalUrl: `https://example.com/${encodeURIComponent(query)}`, snippet: "s", rank: 1 }]);
    const read = vi.fn(async (url: string) => ({ ok: true as const, url, finalUrl: url, title: "page", text: "body", contentType: "text/html", status: 200 }));
    const extractor: EvidenceExtractor = { name: "test", extract: vi.fn(async ({ sources }) => ({ evidence: [{ sourceId: sources[0]!.id, product: sources[0]!.product, dimension: "定位", value: "v", evidenceText: "body", confidence: 1 }] })) };
    const result = await fillEvidenceGaps({ repository, task, runId: run.id, dimensions: ["定位", "定价"], evidence: [], queryPlanner: new DemoGapQueryPlanner(), searchProvider: { name: "test", search }, pageReader: { name: "test", read }, extractor });
    expect(result.selectedGaps).toEqual([{ product: "A", dimension: "定位" }, { product: "B", dimension: "定位" }, { product: "C", dimension: "定位" }]);
    expect(result.searchAttempts).toBe(3);
    expect(result.readAttempts).toBe(3);
    expect(result.filledGaps).toHaveLength(3);
    expect(search).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("isolates invalid queries and per-cell failures", async () => {
    const { repository, task, run } = await setup();
    const result = await fillEvidenceGaps({ repository, task, runId: run.id, dimensions: ["定位"], evidence: [], queryPlanner: { name: "bad", plan: async () => ({ queries: [{ product: "A", dimension: "定位", query: "missing" }, { product: "B", dimension: "定位", query: "B 定位" }, { product: "C", dimension: "定位", query: "C 定位" }] }) }, searchProvider: { name: "test", search: async ({ query }) => { if (query.startsWith("B")) throw new Error("search failed"); return []; } }, pageReader: { name: "test", read: async () => { throw new Error("must not read"); } }, extractor: { name: "test", extract: async () => ({ evidence: [] }) } });
    expect(result.outcomes.map((item) => item.status)).toEqual(["invalid_query", "failed", "no_new_url"]);
    expect(result.searchAttempts).toBe(2);
    expect(result.readAttempts).toBe(0);
  });

  it("tries the second ranked URL only after the first read fails", async () => {
    const { repository, task, run } = await setup();
    const read = vi.fn(async (url: string) => url.endsWith("/first")
      ? { ok: false as const, url, reason: "读取页面失败（403）" }
      : { ok: true as const, url, finalUrl: url, title: "page", text: "body", contentType: "text/html", status: 200 });
    const extractor: EvidenceExtractor = { name: "test", extract: async ({ sources }) => ({ evidence: [{ sourceId: sources[0]!.id, product: "A", dimension: "定位", value: "v", evidenceText: "body", confidence: 1 }] }) };
    const result = await fillEvidenceGaps({ repository, task, runId: run.id, dimensions: ["定位"], evidence: [], queryPlanner: { name: "one", plan: async () => ({ queries: [{ product: "A", dimension: "定位", query: "A 定位" }] }) }, searchProvider: { name: "test", search: async () => [{ title: "first", url: "https://example.com/first", canonicalUrl: "https://example.com/first", snippet: "", rank: 1 }, { title: "second", url: "https://example.com/second", canonicalUrl: "https://example.com/second", snippet: "", rank: 2 }] }, pageReader: { name: "test", read }, extractor });
    expect(read.mock.calls.map(([url]) => url)).toEqual(["https://example.com/first", "https://example.com/second"]);
    expect(result.readAttempts).toBe(2);
    expect(result.filledGaps).toEqual([{ product: "A", dimension: "定位" }]);
  });
});
