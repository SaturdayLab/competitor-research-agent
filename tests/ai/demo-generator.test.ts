import { describe, expect, it } from "vitest";

import { DemoResearchGenerator } from "../../src/lib/ai/demo-generator";
import { ResearchDraftSchema } from "../../src/lib/domain/research";

describe("DemoResearchGenerator", () => {
  it("creates a valid, clearly limited draft for every requested competitor", async () => {
    const output = await new DemoResearchGenerator().generate({
      topic: "协同办公产品竞品分析",
      competitors: ["Notion", "飞书", "Slack"],
      focus: "文档、即时沟通、第三方集成",
    });
    const draft = ResearchDraftSchema.parse(output);

    expect(draft.products.map((product) => product.name)).toEqual(["Notion", "飞书", "Slack"]);
    expect(draft.dimensions.map((dimension) => dimension.name)).toEqual([
      "文档",
      "即时沟通",
      "第三方集成",
    ]);
    expect(draft.limitations.join(" ")).toContain("Evidence");
  });

  it("mentions numbered sources and refuses to treat them as verified facts", async () => {
    const output = await new DemoResearchGenerator().generate({
      topic: "AI Coding 产品分析",
      competitors: ["Cursor", "Claude Code", "Codex"],
      sources: [
        {
          id: "src-1",
          taskId: "task-1",
          runId: "run-1",
          product: "Cursor",
          title: "Cursor overview",
          url: "https://cursor.com",
          canonicalUrl: "https://cursor.com/",
          snippet: "AI coding editor.",
          sourceType: "search_result",
          isOfficial: true,
          retrievedAt: "2026-08-27T00:00:00.000Z",
          metadata: { rank: 1 },
          extractedText: null,
          fetchStatus: "pending",
          fetchError: null,
        },
      ],
    });
    const draft = ResearchDraftSchema.parse(output);
    const limitations = draft.limitations.join(" ");

    expect(limitations).toContain("[S1]");
    expect(limitations).toMatch(/摘要|未读取|未确认/);
    expect(limitations).not.toContain("未调用公开资料搜索");
  });

  it("uses planned dimensions instead of deriving a parallel set from focus", async () => {
    const output = await new DemoResearchGenerator().generate({
      topic: "协同办公",
      competitors: ["飞书", "钉钉", "企业微信"],
      focus: "旧关注点",
      dimensions: ["产品定位", "定价", "集成生态"],
    });
    const draft = ResearchDraftSchema.parse(output);
    expect(draft.dimensions.map((dimension) => dimension.name)).toEqual([
      "产品定位",
      "定价",
      "集成生态",
    ]);
  });

  it("uses the independent analysis summaries when analysis is present", async () => {
    const output = await new DemoResearchGenerator().generate({
      topic: "协同办公",
      competitors: ["飞书", "钉钉", "企业微信"],
      dimensions: ["产品定位", "定价", "集成生态"],
      analysis: {
        dimensions: ["产品定位", "定价", "集成生态"].map((dimension) => ({
          dimension,
          summary: `${dimension} 的 Analyst 横向总结。`,
          productFindings: ["飞书", "钉钉", "企业微信"].map((product) => ({
            product,
            finding: "资料不足。",
            evidenceIds: [],
          })),
          leaders: [],
          evidenceIds: [],
          gaps: ["飞书", "钉钉", "企业微信"].map((product) => ({ product, reason: "资料不足。" })),
        })),
        overallSummary: "Analyst 总结。",
      },
    });
    const draft = ResearchDraftSchema.parse(output);
    expect(draft.dimensions[0]?.summary).toBe("产品定位 的 Analyst 横向总结。");
  });
});
