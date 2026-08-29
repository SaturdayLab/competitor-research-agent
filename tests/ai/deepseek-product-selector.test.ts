import { describe, expect, it, vi } from "vitest";

import { DeepSeekProductSelector } from "@/lib/ai/deepseek-product-selector";

describe("DeepSeekProductSelector", () => {
  it("parses a referenced structured selection", async () => {
    const selection = { products: [
      { name: "产品甲", region: "domestic", reason: "有搜索依据", sourceIds: ["R1"] },
      { name: "Product B", region: "overseas", reason: "有搜索依据", sourceIds: ["R2"] },
    ] };
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(selection) } }],
    });
    const selector = new DeepSeekProductSelector({
      client: { chat: { completions: { create } } },
      model: "deepseek-chat",
    });
    await expect(selector.select({
      category: "AI 产品",
      count: 2,
      scope: "global",
      excludeProducts: ["旧产品"],
      sources: [
        { id: "R1", title: "产品甲", url: "https://a.example", snippet: "甲", regionHint: "domestic" },
        { id: "R2", title: "Product B", url: "https://b.example", snippet: "B", regionHint: "overseas" },
      ],
    })).resolves.toEqual(selection);
    expect(create).toHaveBeenCalledOnce();
    const request = create.mock.calls[0][0];
    expect(request.messages[0].content).toContain("主流优先");
    expect(request.messages[0].content).toContain("竞争层级");
    expect(request.messages[0].content).toContain("官网自述");
    expect(request.messages[0].content).toContain("单一网站流量");
    expect(request.messages[0].content).toContain("新发布");
    expect(request.messages[0].content).toContain("不要为了凑数");
    expect(request.messages[0].content).toContain("excludeProducts");
  });
});
