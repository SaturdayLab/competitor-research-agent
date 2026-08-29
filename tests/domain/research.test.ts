import { describe, expect, it } from "vitest";

import { CreateResearchInputSchema } from "../../src/lib/domain/research";

describe("CreateResearchInputSchema", () => {
  it("normalizes a valid task with three competitors", () => {
    const result = CreateResearchInputSchema.parse({
      topic: "  AI Coding 产品分析  ",
      competitors: [" Cursor ", "Claude Code", "Codex"],
      focus: " Agent 能力、价格 ",
    });

    expect(result).toEqual({
      topic: "AI Coding 产品分析",
      competitors: ["Cursor", "Claude Code", "Codex"],
      focus: "Agent 能力、价格",
    });
  });

  it("accepts two competitors", () => {
    const result = CreateResearchInputSchema.safeParse({
      topic: "AI Coding 产品分析",
      competitors: ["Cursor", "Codex"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects fewer than two competitors", () => {
    const result = CreateResearchInputSchema.safeParse({
      topic: "AI Coding 产品分析",
      competitors: ["Cursor"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate competitors without case sensitivity", () => {
    const result = CreateResearchInputSchema.safeParse({
      topic: "AI Coding 产品分析",
      competitors: ["Cursor", "cursor", "Codex"],
    });

    expect(result.success).toBe(false);
  });
});
