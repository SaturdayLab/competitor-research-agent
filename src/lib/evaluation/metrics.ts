import { numberedResearchEvidence } from "@/lib/ai/extractor";
import type { ResearchAnalysis } from "@/lib/ai/analyst";
import type { ResearchRunBundle } from "@/lib/research/repository";
import type { MetricCalculator, MetricGap, MetricResult } from "@/lib/evaluation/types";

const norm = (value: string) => value.trim().toLocaleLowerCase();
const completedOutput = (bundle: ResearchRunBundle, type: "planning" | "analyzing" | "reviewing") =>
  [...bundle.steps].reverse().find((step) => step.stepType === type && step.status === "completed")?.output;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const dimensionsFromPlan = (bundle: ResearchRunBundle) => stringArray(record(completedOutput(bundle, "planning"))?.dimensions);
const analysisFrom = (bundle: ResearchRunBundle): ResearchAnalysis | null => {
  const value = completedOutput(bundle, "analyzing");
  const root = record(value);
  const candidate = record(root?.analysis) ?? root;
  return candidate && Array.isArray(candidate.dimensions) ? candidate as unknown as ResearchAnalysis : null;
};
const na = (id: string, label: string, stage: MetricResult["stage"], reason: string): MetricResult => ({
  id, label, stage, status: "not_applicable", score: null, summary: "不适用", gaps: [], reason,
  interpretation: reason,
});
const ratioSummary = (score: number, numerator: number, denominator: number) =>
  `${(score * 100).toFixed(1)}%（${numerator}/${denominator}）`;

export const competitorCoverage: MetricCalculator = (bundle) => {
  const expected = bundle.task.competitors;
  const reportNames = new Set(bundle.report?.structuredContent.products.map((item) => norm(item.name)) ?? []);
  const reportGaps = expected.filter((name) => !reportNames.has(norm(name)));
  const analysis = analysisFrom(bundle);
  const analysisGaps: MetricGap[] = [];
  if (analysis) for (const dimension of analysis.dimensions) {
    const names = new Set(dimension.productFindings.map((item) => norm(item.product)));
    for (const product of expected) if (!names.has(norm(product))) analysisGaps.push({ product, dimension: dimension.dimension, detail: "分析缺少竞品" });
  }
  const reportCoverage = (expected.length - reportGaps.length) / expected.length;
  const analysisCells = analysis ? expected.length * analysis.dimensions.length : 0;
  const analysisCoverage = analysisCells ? (analysisCells - analysisGaps.length) / analysisCells : null;
  const score = analysisCoverage === null ? reportCoverage : (reportCoverage + analysisCoverage) / 2;
  const gaps = [...analysisGaps, ...reportGaps.map((product) => ({ product, detail: "报告缺少竞品" }))];
  return { id: "competitor_coverage", label: "竞品覆盖率", status: "ok", score, stage: reportGaps.length ? "generating" : analysisGaps.length ? "analyzing" : "generating", gaps,
    summary: ratioSummary(score, Math.round(score * (analysis ? 2 * expected.length : expected.length)), analysis ? 2 * expected.length : expected.length), interpretation: gaps.length ? "查看分析或报告遗漏的竞品。" : "分析与报告覆盖全部输入竞品。" };
};

export const sourceCoverage: MetricCalculator = (bundle) => {
  if (!completedOutput(bundle, "planning") && !bundle.steps.some((step) => step.stepType === "researching")) return na("source_coverage", "来源覆盖率", "researching", "V1 无搜索路径");
  const covered = new Set(bundle.sources.map((item) => norm(item.product)));
  const missing = bundle.task.competitors.filter((item) => !covered.has(norm(item)));
  const score = (bundle.task.competitors.length - missing.length) / bundle.task.competitors.length;
  return { id: "source_coverage", label: "来源覆盖率", status: "ok", score, stage: "researching", gaps: missing.map((product) => ({ product, detail: "没有来源" })), summary: ratioSummary(score, bundle.task.competitors.length - missing.length, bundle.task.competitors.length), interpretation: missing.length ? "缺失竞品应先检查搜索阶段。" : "每个竞品至少有一条来源。" };
};

export const evidenceCoverage: MetricCalculator = (bundle) => {
  const dimensions = dimensionsFromPlan(bundle);
  if (!dimensions.length) return na("evidence_coverage", "证据覆盖率", "extracting", "V1 无搜索路径");
  const evidenceCells = new Set(bundle.evidence.map((item) => `${norm(item.product)}\0${norm(item.dimension)}`));
  const analysis = analysisFrom(bundle);
  const gaps: MetricGap[] = [];
  for (const product of bundle.task.competitors) for (const dimension of dimensions) {
    if (evidenceCells.has(`${norm(product)}\0${norm(dimension)}`)) continue;
    const item = analysis?.dimensions.find((entry) => norm(entry.dimension) === norm(dimension));
    const admitted = item?.gaps.some((gap) => norm(gap.product) === norm(product)) ?? false;
    const finding = item?.productFindings.find((entry) => norm(entry.product) === norm(product));
    const boundary = (finding?.evidenceIds.length ?? 0) > 0;
    gaps.push({ product, dimension, detail: admitted ? "资料不足，Analyst 已承认，不是幻觉" : boundary ? "无 Evidence 但分析仍有引用，可能越界，请人工抽查" : "无 Evidence 且 Analyst 未登记 gap，请人工抽查" });
  }
  const total = bundle.task.competitors.length * dimensions.length;
  const score = (total - gaps.length) / total;
  return { id: "evidence_coverage", label: "证据覆盖率", status: "ok", score, stage: "extracting", gaps, summary: ratioSummary(score, total - gaps.length, total), interpretation: gaps.length ? "空格子说明资料覆盖不足；已登记 gap 不等于幻觉。" : "竞品与规划维度的 Evidence 格子全部覆盖。" };
};

export const dimensionCompleteness: MetricCalculator = (bundle) => {
  const planned = dimensionsFromPlan(bundle);
  if (!planned.length) return na("dimension_completeness", "维度完整率", "generating", "V1 无搜索路径");
  const expected = new Set(planned.map(norm));
  const analysis = analysisFrom(bundle);
  const analysisNames = new Set(analysis?.dimensions.map((item) => norm(item.dimension)) ?? []);
  const reportNames = new Set(bundle.report?.structuredContent.dimensions.map((item) => norm(item.name)) ?? []);
  const gaps: MetricGap[] = [];
  for (const dimension of planned) {
    if (analysis && !analysisNames.has(norm(dimension))) gaps.push({ dimension, detail: "分析缺少或改名" });
    if (!reportNames.has(norm(dimension))) gaps.push({ dimension, detail: "报告缺少或改名" });
  }
  for (const name of analysisNames) if (!expected.has(name)) gaps.push({ dimension: name, detail: "分析包含额外或改名维度" });
  for (const name of reportNames) if (!expected.has(name)) gaps.push({ dimension: name, detail: "报告包含额外或改名维度" });
  const reportRate = [...expected].filter((name) => reportNames.has(name)).length / expected.size;
  const analysisRate = analysis ? [...expected].filter((name) => analysisNames.has(name)).length / expected.size : null;
  const score = analysisRate === null ? reportRate : (analysisRate + reportRate) / 2;
  return { id: "dimension_completeness", label: "维度完整率", status: "ok", score, stage: "generating", gaps, summary: `${(score * 100).toFixed(1)}%`, interpretation: gaps.length ? "规划、分析与报告存在缺失、额外项或改名。" : "规划维度在分析和报告中同名覆盖。" };
};

export const citationValidity: MetricCalculator = (bundle) => {
  const analysis = analysisFrom(bundle);
  if (!analysis) return na("citation_validity", "引用有效率", "analyzing", completedOutput(bundle, "planning") ? "没有已完成的 analyzing 步骤" : "V1 无搜索路径");
  const valid = new Set(numberedResearchEvidence(bundle.evidence).map((item) => item.id));
  const refs: Array<{ id: string; product?: string; dimension: string }> = [];
  for (const dimension of analysis.dimensions) {
    for (const id of dimension.evidenceIds) refs.push({ id, dimension: dimension.dimension });
    for (const finding of dimension.productFindings) for (const id of finding.evidenceIds) refs.push({ id, product: finding.product, dimension: dimension.dimension });
  }
  const invalid = refs.filter((item) => !valid.has(item.id as `E${number}`));
  const score = refs.length ? (refs.length - invalid.length) / refs.length : 1;
  return { id: "citation_validity", label: "引用有效率", status: "ok", score, stage: "analyzing", gaps: invalid.map((item) => ({ product: item.product, dimension: item.dimension, detail: `不存在的 Evidence 编号：${item.id}` })), summary: ratioSummary(score, refs.length - invalid.length, refs.length), interpretation: "100% 只说明 E 编号存在，不说明结论正确。" };
};

export const pageReadSuccess: MetricCalculator = (bundle) => {
  const denominator = bundle.sources.filter((item) => item.fetchStatus === "ok" || item.fetchStatus === "skipped");
  if (!denominator.length) return na("page_read_success", "页面读取成功率", "extracting", "没有已完成或跳过的页面读取记录");
  const ok = denominator.filter((item) => item.fetchStatus === "ok").length;
  const gaps = bundle.sources.filter((item) => item.fetchStatus !== "ok").map((item) => ({ product: item.product, detail: item.fetchStatus === "pending" ? `已完成 Run 仍为 pending：${item.canonicalUrl || item.url}` : `读取跳过：${item.canonicalUrl || item.url}` }));
  return { id: "page_read_success", label: "页面读取成功率", status: "ok", score: ok / denominator.length, stage: "extracting", gaps, summary: ratioSummary(ok / denominator.length, ok, denominator.length), interpretation: gaps.length ? "跳过较多时应先检查读页阶段。" : "所有进入分母的页面均读取成功。" };
};

export const gapFillEffectiveness: MetricCalculator = (bundle) => {
  const step = [...bundle.steps].reverse().find((item) => item.stepType === "gap_filling" && item.status === "completed");
  if (!step) return na("gap_fill_effectiveness", "缺口补全效果", "gap_filling", "该 Run 没有 gap_filling 步骤");
  const output = record(step.output);
  const asGaps = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => {
    const row = record(item);
    return typeof row?.product === "string" && typeof row?.dimension === "string" ? [{ product: row.product, dimension: row.dimension }] : [];
  }) : [];
  const candidates = asGaps(output?.candidateGaps);
  const selected = asGaps(output?.selectedGaps);
  const filled = asGaps(output?.filledGaps);
  const remaining = asGaps(output?.remainingGaps);
  const searches = typeof output?.searchAttempts === "number" ? output.searchAttempts : 0;
  const reads = typeof output?.readAttempts === "number" ? output.readAttempts : 0;
  const total = bundle.task.competitors.length * dimensionsFromPlan(bundle).length;
  const beforeCovered = Math.max(0, total - candidates.length);
  const afterCovered = Math.max(0, total - remaining.length);
  const score = selected.length ? filled.length / selected.length : 1;
  const filledKeys = new Set(filled.map((gap) => `${norm(gap.product)}\0${norm(gap.dimension)}`));
  const gaps = selected.filter((gap) => !filledKeys.has(`${norm(gap.product)}\0${norm(gap.dimension)}`)).map((gap) => ({ ...gap, detail: "已选择但未补到 Evidence" }));
  return { id: "gap_fill_effectiveness", label: "缺口补全效果", status: "ok", score, stage: "gap_filling", gaps,
    summary: `补全前 ${beforeCovered}/${total}，补全后 ${afterCovered}/${total}；选中 ${selected.length} 格，补到 ${filled.length} 格；${searches} 搜 / ${reads} 读`,
    interpretation: "该比例只表示选中缺口的补全成功率；搜索结果可读性会直接影响结果。" };
};

export const reviewerStatus: MetricCalculator = (bundle) => {
  const output = record(completedOutput(bundle, "reviewing"));
  const notes = Array.isArray(output?.notes) ? output.notes.length : 0;
  const verdict = typeof output?.verdict === "string" ? output.verdict : null;
  return { id: "reviewer_status", label: "Reviewer 状态", status: "ok", score: null, stage: "reviewing", gaps: [], summary: output ? `${bundle.report?.reviewStatus ?? "not_reviewed"}，revision ${bundle.report?.revision ?? 0}${verdict ? `，verdict ${verdict}` : ""}，notes ${notes}` : "未启用 Reviewer", interpretation: "passed 不代表报告好，只代表 Reviewer 未要求再改。" };
};

const unavailable = (id: string, label: string, stage: MetricResult["stage"], reason: string): MetricCalculator => () => ({ id, label, stage, status: "not_available", score: null, summary: "首版不可自动计算", gaps: [], reason, interpretation: reason });
export const keyFactsGrounded = unavailable("key_facts_grounded", "关键事实有来源比例", "generating", "报告 Schema 没有事实级 evidenceIds，不能自动计算");
export const reviewerDetectionRate = unavailable("reviewer_detection_rate", "Reviewer 问题发现率", "reviewing", "需要带人工标注的缺陷样本，首版没有");

export const DEFAULT_METRIC_CALCULATORS: MetricCalculator[] = [competitorCoverage, sourceCoverage, evidenceCoverage, dimensionCompleteness, citationValidity, pageReadSuccess, gapFillEffectiveness, reviewerStatus, keyFactsGrounded, reviewerDetectionRate];
