import { completeJsonObject, createDeepSeekClient, getDeepSeekModel, type JsonChatClient } from "@/lib/ai/deepseek-client";
import { numberedResearchEvidence } from "@/lib/ai/extractor";
import { numberedResearchSources } from "@/lib/ai/generator";
import type { ResearchReviewer, ReviewInput } from "@/lib/ai/reviewer";

const REVIEW_JSON_SHAPE = `{
  "verdict": "pass or revise",
  "notes": ["string"]
}`;

export function normalizeDeepSeekReview(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const review = raw as Record<string, unknown>;
  const forbiddenRequests = [
    /productFindings/i,
    /evidenceIds/i,
    /(?:dimensions|products).*gaps/i,
    /(?:products|limitations).*证据\s*ID/i,
  ];
  const notes = Array.isArray(review.notes)
    ? [...new Set(
        review.notes
          .filter((note): note is string => typeof note === "string")
          .map((note) => note.trim())
          .filter((note) => note.length > 0)
          .filter((note) => !forbiddenRequests.some((pattern) => pattern.test(note))),
      )].slice(0, 5)
    : review.notes;
  return {
    ...review,
    verdict: review.verdict === "revise" && Array.isArray(notes) && notes.length === 0
      ? "pass"
      : review.verdict,
    notes,
  };
}

export class DeepSeekResearchReviewer implements ResearchReviewer {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;

  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }

  async review(input: ReviewInput): Promise<unknown> {
    const raw = await completeJsonObject(this.client, {
      model: this.model,
      maxTokens: 4_096,
      system: [
        "你是竞品报告审核员。",
        "检查是否覆盖全部竞品、关键结论是否能在证据摘录中找到、数字是否互相冲突、当前报告字段是否完整。",
        "不要要求报告包含证据里没有的新事实。",
        "报告只能包含 title、executiveSummary、products、dimensions、conclusion、limitations 及其现有子字段。",
        "不得要求新增报告 Schema 之外的字段，例如 productFindings、gaps、evidenceIds 或逐字段证据 ID。",
        ...(input.dimensions?.length ? ["检查报告是否覆盖计划分析维度；缺失时倾向要求修改。"] : []),
        ...(input.analysis
          ? ["analysis 仅用于核对事实、维度与已知证据缺口；报告可以压缩表达，不得要求直接复制 analysis 的内部结构。"]
          : []),
        "通过则 verdict 为 pass；需要修改则 revise，并在 notes 写出最多 5 条具体、可在当前报告 Schema 内完成的修改意见；不要重复。",
        "必须输出 JSON。",
        `JSON 形状：${REVIEW_JSON_SHAPE}`,
      ].join("\n"),
      user: JSON.stringify({
        topic: input.task.topic,
        competitors: input.task.competitors,
        focus: input.task.focus,
        dimensions: input.dimensions,
        analysis: input.analysis,
        draft: input.draft,
        sources: numberedResearchSources(input.sources),
        evidence: numberedResearchEvidence(input.evidence),
      }),
    });
    return normalizeDeepSeekReview(raw);
  }
}
