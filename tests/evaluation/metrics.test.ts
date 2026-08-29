import { describe, expect, it } from "vitest";

import { evaluateRunBundle } from "@/lib/evaluation/evaluate";
import { citationValidity, evidenceCoverage } from "@/lib/evaluation/metrics";
import type { ResearchRunBundle } from "@/lib/research/repository";

const competitors = ["Alpha", "Beta", "Gamma"];
const dimensions = ["定位", "定价", "生态"];

function bundle(v1 = false): ResearchRunBundle {
  const now = "2026-08-28T00:00:00.000Z";
  const task = { id: "task-1", userId: null, topic: "测试主题", competitors, focus: null, status: "completed" as const, currentStep: null, error: null, createdAt: now, updatedAt: now };
  const run = { id: "run-1", taskId: task.id, status: "completed" as const, attemptCount: 1, workerId: "worker", startedAt: now, finishedAt: now, createdAt: now };
  const report = { id: "report-1", taskId: task.id, runId: run.id, title: "报告", content: "", reviewStatus: "passed" as const, revision: 1, createdAt: now, structuredContent: { title: "报告", executiveSummary: "摘要", products: competitors.map((name) => ({ name, positioning: "定位", strengths: ["优势"], limitations: ["不足"], bestFor: "用户" })), dimensions: (v1 ? ["定位"] : dimensions).map((name) => ({ name, summary: "总结", leaders: [] })), conclusion: "结论", limitations: ["局限"] } };
  if (v1) return { task, run, report, steps: [], sources: [], evidence: [] };
  const evidence = competitors.flatMap((product, productIndex) => dimensions.flatMap((dimension, dimensionIndex) => product === "Gamma" && dimension === "生态" ? [] : [{ id: `e-${productIndex}-${dimensionIndex}`, taskId: task.id, sourceId: `s-${productIndex}`, product, dimension, value: {}, evidenceText: "证据", confidence: 0.9, createdAt: now }]));
  const idsByCell = new Map(evidence.map((item, index) => [`${item.product}/${item.dimension}`, [`E${index + 1}`]]));
  const analysis = { dimensions: dimensions.map((dimension) => ({ dimension, summary: "总结", productFindings: competitors.map((product) => ({ product, finding: "发现", evidenceIds: idsByCell.get(`${product}/${dimension}`) ?? [] })), leaders: [], evidenceIds: competitors.flatMap((product) => idsByCell.get(`${product}/${dimension}`) ?? []), gaps: dimension === "生态" ? [{ product: "Gamma", reason: "资料不足" }] : [] })), overallSummary: "总结" };
  const steps = [
    { id: "p", runId: run.id, taskId: task.id, stepType: "planning" as const, status: "completed" as const, input: {}, output: { dimensions }, error: null, attempt: 1, startedAt: now, finishedAt: now, createdAt: now },
    { id: "a", runId: run.id, taskId: task.id, stepType: "analyzing" as const, status: "completed" as const, input: {}, output: analysis, error: null, attempt: 1, startedAt: now, finishedAt: now, createdAt: now },
  ];
  const sources = competitors.map((product, index) => ({ id: `s-${index}`, taskId: task.id, runId: run.id, product, title: product, url: `https://example.com/${index}`, canonicalUrl: `https://example.com/${index}`, snippet: "摘要", sourceType: "search_result" as const, isOfficial: false, retrievedAt: now, metadata: {}, extractedText: "正文", fetchStatus: "ok" as const, fetchError: null }));
  return { task, run, report, steps, sources, evidence };
}

describe("evaluation metrics", () => {
  it("lists an admitted empty evidence cell", () => {
    const result = evidenceCoverage(bundle());
    expect(result.score).toBe(8 / 9);
    expect(result.gaps).toEqual([{ product: "Gamma", dimension: "生态", detail: "资料不足，Analyst 已承认，不是幻觉" }]);
  });

  it("catches an invalid E number", () => {
    const fixture = bundle();
    const analysis = fixture.steps.find((step) => step.stepType === "analyzing")!.output as { dimensions: Array<{ dimension: string; productFindings: Array<{ product: string; evidenceIds: string[] }>; evidenceIds: string[] }> };
    analysis.dimensions[0]!.productFindings[0]!.evidenceIds = ["E99"];
    const result = citationValidity(fixture);
    expect(result.score).toBeLessThan(1);
    expect(result.gaps[0]?.detail).toContain("E99");
  });

  it("marks V1 search metrics not applicable but still scores report coverage", () => {
    const result = evaluateRunBundle(bundle(true));
    expect(result.metrics.find((item) => item.id === "competitor_coverage")?.score).toBe(1);
    expect(result.metrics.find((item) => item.id === "source_coverage")?.status).toBe("not_applicable");
    expect(result.metrics.find((item) => item.id === "evidence_coverage")?.reason).toBe("V1 无搜索路径");
  });

  it("keeps unavailable metrics explicit and isolates calculator errors", () => {
    const report = evaluateRunBundle(bundle(), undefined, [
      evidenceCoverage,
      () => { throw new Error("boom"); },
    ]);
    expect(report.metrics[0]?.status).toBe("ok");
    expect(report.metrics[1]).toMatchObject({ status: "error", reason: "boom" });
    const full = evaluateRunBundle(bundle());
    expect(full.metrics.find((item) => item.id === "key_facts_grounded")?.status).toBe("not_available");
    expect(full.metrics.find((item) => item.id === "reviewer_detection_rate")?.status).toBe("not_available");
  });

  it("summarizes gap filling before and after coverage", () => {
    const fixture = bundle();
    const now = fixture.run.createdAt;
    fixture.steps.push({ id: "g", runId: fixture.run.id, taskId: fixture.task.id, stepType: "gap_filling", status: "completed", input: {}, output: { candidateGaps: [{ product: "Gamma", dimension: "生态" }, { product: "Beta", dimension: "定价" }], selectedGaps: [{ product: "Gamma", dimension: "生态" }, { product: "Beta", dimension: "定价" }], filledGaps: [{ product: "Beta", dimension: "定价" }], remainingGaps: [{ product: "Gamma", dimension: "生态" }], searchAttempts: 2, readAttempts: 2 }, error: null, attempt: 1, startedAt: now, finishedAt: now, createdAt: now });
    const metric = evaluateRunBundle(fixture).metrics.find((item) => item.id === "gap_fill_effectiveness");
    expect(metric).toMatchObject({ status: "ok", score: 0.5 });
    expect(metric?.summary).toContain("补全前 7/9，补全后 8/9");
    expect(metric?.summary).toContain("2 搜 / 2 读");
  });

  it("matches product and dimension names case-insensitively", () => {
    const fixture = bundle();
    fixture.task.competitors[0] = " alpha ";
    const plan = fixture.steps.find((step) => step.stepType === "planning")!.output as { dimensions: string[] };
    plan.dimensions[0] = " 定位 ";
    expect(evidenceCoverage(fixture).gaps).toHaveLength(1);
  });
});
