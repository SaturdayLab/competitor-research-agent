import type { ResearchRunBundle } from "@/lib/research/repository";

export type EvaluationStage =
  | "planning" | "researching" | "extracting" | "gap_filling" | "analyzing"
  | "generating" | "reviewing" | "run";

export type MetricStatus = "ok" | "not_applicable" | "not_available" | "error";
export type MetricGap = { product?: string; dimension?: string; detail: string };
export type MetricResult = {
  id: string;
  label: string;
  status: MetricStatus;
  score: number | null;
  summary: string;
  stage: EvaluationStage;
  gaps: MetricGap[];
  interpretation: string;
  reason?: string;
};
export type EvaluationReport = {
  runId: string;
  taskId: string;
  topic: string;
  competitors: string[];
  evaluatedAt: string;
  metrics: MetricResult[];
};
export type MetricCalculator = (bundle: ResearchRunBundle) => MetricResult;
