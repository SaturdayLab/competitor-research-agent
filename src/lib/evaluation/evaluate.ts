import type { ResearchRepository, ResearchRunBundle } from "@/lib/research/repository";
import { DEFAULT_METRIC_CALCULATORS } from "@/lib/evaluation/metrics";
import type { EvaluationReport, MetricCalculator, MetricResult } from "@/lib/evaluation/types";

export class EvaluationInputError extends Error {}

export function evaluateRunBundle(bundle: ResearchRunBundle, evaluatedAt = new Date().toISOString(), calculators: MetricCalculator[] = DEFAULT_METRIC_CALCULATORS): EvaluationReport {
  const metrics: MetricResult[] = calculators.map((calculate, index) => {
    try { return calculate(bundle); }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { id: `metric_${index + 1}`, label: `指标 ${index + 1}`, status: "error", score: null, summary: "计算失败", stage: "run", gaps: [], reason, interpretation: "该指标计算异常，其余指标仍继续。" };
    }
  });
  return { runId: bundle.run.id, taskId: bundle.task.id, topic: bundle.task.topic, competitors: bundle.task.competitors, evaluatedAt, metrics };
}

export async function evaluateCompletedRun(repository: ResearchRepository, runId: string, evaluatedAt?: string): Promise<EvaluationReport> {
  const bundle = await repository.getRunBundle(runId);
  if (!bundle) throw new EvaluationInputError("Run 不存在");
  if (bundle.run.status !== "completed") throw new EvaluationInputError("Run 尚未完成");
  if (!bundle.report || bundle.report.runId !== runId) throw new EvaluationInputError("该 Run 没有报告");
  return evaluateRunBundle(bundle, evaluatedAt);
}
