import { z } from "zod";

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label}必须是文本` })
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}不能超过 ${max} 个字符`);

const competitorNameSchema = requiredText("竞品名称", 80);

export const CreateResearchInputSchema = z.object({
  topic: requiredText("调研主题", 160).min(3, "调研主题至少需要 3 个字符"),
  competitors: z
    .array(competitorNameSchema)
    .min(2, "至少需要 2 个竞品")
    .max(6, "单次最多支持 6 个竞品")
    .superRefine((competitors, context) => {
      const normalized = competitors.map((competitor) => competitor.toLocaleLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        context.addIssue({
          code: "custom",
          message: "竞品名称不能重复",
        });
      }
    }),
  focus: z
    .string()
    .trim()
    .max(500, "重点关注不能超过 500 个字符")
    .optional()
    .transform((value) => value || undefined),
});

export interface CreateResearchInput {
  topic: string;
  competitors: string[];
  focus?: string;
}

export const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const RunStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepTypeSchema = z.enum([
  "planning",
  "researching",
  "extracting",
  "gap_filling",
  "analyzing",
  "generating",
  "writing",
  "reviewing",
]);
export type StepType = z.infer<typeof StepTypeSchema>;

export const ProductBriefSchema = z.object({
  name: requiredText("产品名称", 80),
  positioning: requiredText("产品定位", 500),
  strengths: z.array(requiredText("优势", 300)).min(1).max(8),
  limitations: z.array(requiredText("不足", 300)).min(1).max(8),
  bestFor: requiredText("适用人群", 500),
});

export const ResearchDimensionSchema = z.object({
  name: requiredText("分析维度", 100),
  summary: requiredText("维度分析", 1_500),
  leaders: z.array(requiredText("领先产品", 80)).max(6),
});

export const ResearchDraftSchema = z.object({
  title: requiredText("报告标题", 180),
  executiveSummary: requiredText("执行摘要", 2_000),
  products: z.array(ProductBriefSchema).min(2).max(6),
  dimensions: z.array(ResearchDimensionSchema).min(1).max(12),
  conclusion: requiredText("最终结论", 2_000),
  limitations: z.array(requiredText("局限说明", 500)).min(1).max(8),
});

export type ResearchDraft = z.infer<typeof ResearchDraftSchema>;

export interface ResearchTask {
  id: string;
  userId: string | null;
  topic: string;
  competitors: string[];
  focus: string | null;
  status: TaskStatus;
  currentStep: StepType | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  taskId: string;
  status: RunStatus;
  attemptCount: number;
  workerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ResearchStep {
  id: string;
  runId: string;
  taskId: string;
  stepType: StepType;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ResearchReport {
  id: string;
  taskId: string;
  runId: string;
  title: string;
  content: string;
  structuredContent: ResearchDraft;
  reviewStatus: "not_reviewed" | "passed" | "revision_requested";
  revision: number;
  createdAt: string;
}

export const FetchStatusSchema = z.enum(["pending", "ok", "skipped"]);
export type FetchStatus = z.infer<typeof FetchStatusSchema>;

export interface ResearchSource {
  id: string;
  taskId: string;
  runId: string;
  product: string;
  title: string;
  url: string;
  canonicalUrl: string;
  snippet: string;
  sourceType: "search_result" | "web_page";
  isOfficial: boolean;
  retrievedAt: string;
  metadata: Record<string, unknown>;
  extractedText: string | null;
  fetchStatus: FetchStatus;
  fetchError: string | null;
}

export interface ResearchEvidence {
  id: string;
  taskId: string;
  sourceId: string;
  product: string;
  dimension: string;
  value: unknown;
  evidenceText: string;
  confidence: number | null;
  createdAt: string;
}

export interface ResearchTaskDetail {
  task: ResearchTask;
  steps: ResearchStep[];
  report: ResearchReport | null;
  sourceCount: number;
}
