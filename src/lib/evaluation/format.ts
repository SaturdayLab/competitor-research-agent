import type { EvaluationReport, MetricResult } from "@/lib/evaluation/types";

const display = (metric: MetricResult) => metric.status === "ok" && metric.score !== null ? `${(metric.score * 100).toFixed(1)}%` : metric.status;
export function formatEvaluationConsole(report: EvaluationReport): string {
  return [`Run: ${report.runId}`, `Task: ${report.taskId}`, `主题: ${report.topic}`, "", ...report.metrics.map((metric) => `${metric.label}: ${display(metric)} — ${metric.summary}`), "", "证据覆盖空格子:", ...(report.metrics.find((item) => item.id === "evidence_coverage")?.gaps.map((gap) => `- ${gap.product ?? "-"} / ${gap.dimension ?? "-"}: ${gap.detail}`) ?? ["- 无"])].join("\n");
}

export function formatEvaluationMarkdown(report: EvaluationReport): string {
  const rows = report.metrics.map((metric) => `| ${metric.label} | ${display(metric)} | ${metric.stage} | ${metric.summary.replaceAll("|", "\\|")} |`);
  const details = report.metrics.map((metric) => [`## ${metric.label}`, "", metric.interpretation, ...(metric.reason ? ["", `原因：${metric.reason}`] : []), "", ...(metric.gaps.length ? metric.gaps.map((gap) => `- ${[gap.product, gap.dimension].filter(Boolean).join(" / ") || metric.stage}：${gap.detail}`) : ["- 无缺口"]), ""].join("\n"));
  return [`# Evaluation 体检单`, "", `- Run：${report.runId}`, `- Task：${report.taskId}`, `- 主题：${report.topic}`, `- 评测时间：${report.evaluatedAt}`, "", "| 指标 | 分数/状态 | 阶段 | 摘要 |", "|---|---:|---|---|", ...rows, "", ...details, "## 怎么读", "", "1. 有 Evidence 缺口且 Analyst 已记 gap，表示资料不够，不是幻觉；只有该维度重要时才考虑定向补搜。", "2. 有缺口但报告仍写具体价格、版本或功能事实，可能越界；首版只能提示抽查，不能输出幻觉率。", "3. 某竞品没有 Source 或页面大量 skipped，应先检查搜索或读页，不要先改 Analyst / Writer。", "4. 引用有效率 100% 只说明 E 编号没写飞，不说明结论正确。", "5. Reviewer passed 只说明没有触发再生成，不说明报告可用。", ""].join("\n");
}
