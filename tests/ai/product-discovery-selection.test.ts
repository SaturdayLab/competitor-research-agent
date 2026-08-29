import { describe, expect, it } from "vitest";

import {
  getCategorySpecificityHint,
  getRefreshExclusions,
  getSynchronizedAutomaticTopic,
  mergeRefreshedProducts,
} from "@/lib/ai/product-discovery-selection";

const product = (name: string) => ({
  name,
  region: "domestic" as const,
  reason: `${name} 的理由`,
  sourceIds: ["R1"],
});

describe("mergeRefreshedProducts", () => {
  it("keeps locked products in place and replaces only unlocked slots", () => {
    const merged = mergeRefreshedProducts(
      [product("WPS"), product("旧候选"), product("钉钉")],
      [product("腾讯会议")],
      new Set(["WPS", "钉钉"]),
      3,
    );
    expect(merged.map((item) => item.name)).toEqual(["WPS", "腾讯会议", "钉钉"]);
  });

  it("deduplicates incoming products and respects the requested total", () => {
    const merged = mergeRefreshedProducts(
      [product("WPS"), product("旧候选")],
      [product("WPS"), product("飞书"), product("钉钉")],
      new Set(["WPS"]),
      2,
    );
    expect(merged.map((item) => item.name)).toEqual(["WPS", "飞书"]);
  });

  it("suggests a narrower category for broad inputs without blocking specific ones", () => {
    expect(getCategorySpecificityHint("办公")).toContain("协同办公");
    expect(getCategorySpecificityHint("AI")).toContain("AI 编程助手");
    expect(getCategorySpecificityHint("AI 编程助手")).toBeNull();
  });

  it("excludes both locked and unlocked current candidates when refreshing", () => {
    expect(getRefreshExclusions(["更早候选"], [product("WPS"), product("钉钉")]))
      .toEqual(["更早候选", "WPS", "钉钉"]);
  });

  it("updates an automatically generated topic but preserves a manually edited topic", () => {
    expect(getSynchronizedAutomaticTopic("AI竞品分析", "AI竞品分析", "办公"))
      .toBe("办公竞品分析");
    expect(getSynchronizedAutomaticTopic("我自定义的主题", null, "办公"))
      .toBe("我自定义的主题");
    expect(getSynchronizedAutomaticTopic("", null, "办公"))
      .toBe("办公竞品分析");
  });
});
