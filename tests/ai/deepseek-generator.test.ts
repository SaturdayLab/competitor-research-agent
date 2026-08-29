import { describe, expect, it, vi } from "vitest";

import { DeepSeekEvidenceExtractor } from "@/lib/ai/deepseek-extractor";
import { DeepSeekResearchGenerator, normalizeDeepSeekDraft } from "@/lib/ai/deepseek-generator";
import type { JsonChatClient } from "@/lib/ai/deepseek-client";
import { ResearchDraftSchema } from "@/lib/domain/research";
import type { ResearchSource } from "@/lib/domain/research";

const draft = {
  title: "AI Coding 产品竞品分析",
  executiveSummary: "三款产品以不同入口服务软件开发流程。",
  products: [
    {
      name: "Cursor",
      positioning: "AI 原生编辑器",
      strengths: ["编辑器体验完整"],
      limitations: ["资料不足处已标明"],
      bestFor: "偏好图形化 IDE 的开发者",
    },
    {
      name: "Claude Code",
      positioning: "终端编码代理",
      strengths: ["终端工作流自然"],
      limitations: ["资料不足处已标明"],
      bestFor: "CLI 用户",
    },
    {
      name: "Codex",
      positioning: "任务式编码代理",
      strengths: ["便于委派任务"],
      limitations: ["资料不足处已标明"],
      bestFor: "需要异步委派的团队",
    },
  ],
  dimensions: [
    {
      name: "交互形态",
      summary: "IDE、CLI 和任务委派代表三种不同入口。",
      leaders: ["Cursor"],
    },
  ],
  conclusion: "选择应匹配团队已有的开发工作流。",
  limitations: ["摘录未出现的价格视为未确认。"],
};

function mockClient(payload: unknown): JsonChatClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }],
        }),
      },
    },
  };
}

function source(): ResearchSource {
  return {
    id: "src-1",
    taskId: "task-1",
    runId: "run-1",
    product: "Cursor",
    title: "Cursor",
    url: "https://cursor.com",
    canonicalUrl: "https://cursor.com/",
    snippet: "AI editor",
    sourceType: "search_result",
    isOfficial: true,
    retrievedAt: "2026-08-27T00:00:00.000Z",
    metadata: {},
    extractedText: "Hobby is $20 per month.",
    fetchStatus: "ok",
    fetchError: null,
  };
}

describe("DeepSeekResearchGenerator", () => {
  it("returns a draft that passes the research schema", async () => {
    const generator = new DeepSeekResearchGenerator({
      client: mockClient(draft),
      model: "deepseek-chat",
    });
    const parsed = ResearchDraftSchema.parse(
      await generator.generate({
        topic: "AI Coding 产品分析",
        competitors: ["Cursor", "Claude Code", "Codex"],
      }),
    );
    expect(parsed.title).toBe(draft.title);
    expect(generator.name).toBe("deepseek");
  });

  it("caps verbose model arrays at the existing schema limits", () => {
    const verbose = {
      ...draft,
      limitations: Array.from({ length: 10 }, (_, index) => `局限 ${index + 1}`),
      products: draft.products.map((product) => ({
        ...product,
        strengths: Array.from({ length: 10 }, (_, index) => `优势 ${index + 1}`),
        limitations: Array.from({ length: 10 }, (_, index) => `不足 ${index + 1}`),
      })),
    };
    const parsed = ResearchDraftSchema.parse(normalizeDeepSeekDraft(verbose));
    expect(parsed.limitations).toHaveLength(8);
    expect(parsed.products.every((product) => product.strengths.length === 8)).toBe(true);
    expect(parsed.products.every((product) => product.limitations.length === 8)).toBe(true);
  });

  it("uses evidence-safe placeholders when required model lists are empty", () => {
    const emptyLists = {
      ...draft,
      limitations: [],
      products: draft.products.map((product) => ({
        ...product,
        strengths: [],
        limitations: [],
      })),
    };

    const parsed = ResearchDraftSchema.parse(normalizeDeepSeekDraft(emptyLists));

    expect(parsed.limitations).toEqual(["现有证据仍有不足，报告结论建议人工复核。"]);
    expect(parsed.products[0]?.strengths).toEqual(["现有证据不足，暂不作优势判断。"]);
    expect(parsed.products[0]?.limitations).toEqual([
      "现有证据不足，建议人工确认该产品的局限。",
    ]);
  });
});

describe("DeepSeekEvidenceExtractor", () => {
  it("returns an evidence list object from json_object output", async () => {
    const extractor = new DeepSeekEvidenceExtractor({
      client: mockClient({
        evidence: [
          {
            sourceId: "src-1",
            product: "Cursor",
            dimension: "价格",
            value: "$20",
            evidenceText: "Hobby is $20 per month.",
            confidence: 0.7,
          },
        ],
      }),
      model: "deepseek-chat",
    });
    const raw = await extractor.extract({
      topic: "AI Coding",
      competitors: ["Cursor", "Claude Code", "Codex"],
      sources: [source()],
      dimensions: ["产品定位", "定价", "集成生态"],
    });
    expect(raw).toMatchObject({
      evidence: [{ sourceId: "src-1", product: "Cursor" }],
    });
  });
});
