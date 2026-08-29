import { describe, expect, it, vi } from "vitest";

import { DeepSeekResearchReviewer, normalizeDeepSeekReview } from "@/lib/ai/deepseek-reviewer";
import { DisabledResearchReviewer, ReviewResultSchema } from "@/lib/ai/reviewer";
import type { ResearchDraft } from "@/lib/domain/research";

const draft: ResearchDraft = {
  title: "测试报告",
  executiveSummary: "摘要",
  products: [
    {
      name: "Cursor",
      positioning: "编辑器",
      strengths: ["完整"],
      limitations: ["订阅"],
      bestFor: "IDE 用户",
    },
    {
      name: "Claude Code",
      positioning: "CLI",
      strengths: ["终端"],
      limitations: ["无 IDE"],
      bestFor: "CLI 用户",
    },
    {
      name: "Codex",
      positioning: "任务代理",
      strengths: ["委派"],
      limitations: ["环境"],
      bestFor: "团队",
    },
  ],
  dimensions: [{ name: "形态", summary: "三种入口。", leaders: ["Cursor"] }],
  conclusion: "按工作流选择。",
  limitations: ["测试稿。"],
};

describe("DisabledResearchReviewer", () => {
  it("always passes", async () => {
    const result = ReviewResultSchema.parse(await new DisabledResearchReviewer().review({
      task: { topic: "t", competitors: ["Cursor", "Claude Code", "Codex"] },
      draft,
    }));
    expect(result.verdict).toBe("pass");
  });
});

describe("DeepSeekResearchReviewer", () => {
  it("parses a json review verdict", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ verdict: "revise", notes: ["补充价格缺口说明"] }) },
        },
      ],
    });
    const reviewer = new DeepSeekResearchReviewer({
      client: { chat: { completions: { create } } },
      model: "deepseek-chat",
    });
    const result = ReviewResultSchema.parse(
      await reviewer.review({
        task: { topic: "AI Coding", competitors: ["Cursor", "Claude Code", "Codex"] },
        draft,
        dimensions: ["产品定位", "定价", "集成生态"],
        analysis: {
          dimensions: ["产品定位", "定价", "集成生态"].map((dimension) => ({
            dimension,
            summary: `${dimension} 总结。`,
            productFindings: ["Cursor", "Claude Code", "Codex"].map((product) => ({
              product,
              finding: "资料不足。",
              evidenceIds: [],
            })),
            leaders: [],
            evidenceIds: [],
            gaps: ["Cursor", "Claude Code", "Codex"].map((product) => ({ product, reason: "资料不足。" })),
          })),
          overallSummary: "横向总结。",
        },
      }),
    );
    expect(result).toEqual({ verdict: "revise", notes: ["补充价格缺口说明"] });
    const request = create.mock.calls[0]?.[0] as { messages?: Array<{ content?: string }> };
    expect(request.messages?.[0]?.content).toContain("覆盖计划分析维度");
    expect(request.messages?.[1]?.content).toContain("集成生态");
    expect(request.messages?.[0]?.content).toContain("不得要求新增报告 Schema 之外的字段");
    expect(request.messages?.[0]?.content).toContain("analysis 仅用于核对事实");
  });

  it("deduplicates notes, removes impossible schema requests, and keeps at most five", () => {
    const parsed = ReviewResultSchema.parse(
      normalizeDeepSeekReview({
        verdict: "revise",
        notes: [
          "补充价格证据不足的说明",
          "补充价格证据不足的说明",
          "在 dimensions 中增加 productFindings",
          "在 products 中增加 evidenceIds",
          ...Array.from({ length: 8 }, (_, index) => `有效修改意见 ${index + 1}`),
        ],
      }),
    );
    expect(parsed.notes).toHaveLength(5);
    expect(parsed.notes).toContain("补充价格证据不足的说明");
    expect(parsed.notes.join(" ")).not.toMatch(/productFindings|evidenceIds/);
  });

  it("passes when every revision note asks for unsupported report fields", () => {
    expect(ReviewResultSchema.parse(normalizeDeepSeekReview({
      verdict: "revise",
      notes: ["在 dimensions 中增加 productFindings 和 evidenceIds"],
    }))).toEqual({ verdict: "pass", notes: [] });
  });
});
