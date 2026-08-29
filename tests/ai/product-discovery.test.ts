import { describe, expect, it, vi } from "vitest";

import { discoverProducts, type ProductSelector } from "@/lib/ai/product-discovery";
import type { SearchProvider, SearchResult } from "@/lib/search/provider";

function result(title: string, rank: number): SearchResult {
  return {
    title,
    url: `https://example.com/${rank}`,
    canonicalUrl: `https://example.com/${rank}`,
    snippet: `${title} product page`,
    rank,
  };
}

function dependencies(selection: unknown) {
  const search = vi.fn().mockResolvedValue([result("候选产品", 1), result("Candidate", 2)]);
  const searchProvider: SearchProvider = { name: "brave", search };
  const selector: ProductSelector = { name: "test", select: vi.fn().mockResolvedValue(selection) };
  return { searchProvider, selector, search };
}

describe("discoverProducts", () => {
  it("uses one search for a domestic scope and returns referenced products", async () => {
    const deps = dependencies({ products: [
      { name: "产品甲", region: "domestic", reason: "国内代表产品", sourceIds: ["R1"] },
      { name: "产品乙", region: "domestic", reason: "国内代表产品", sourceIds: ["R2"] },
    ] });
    const found = await discoverProducts({ category: "AI 产品", count: 2, scope: "domestic" }, deps);
    expect(found.products).toHaveLength(2);
    expect(found.searchCount).toBe(1);
    expect(deps.search).toHaveBeenCalledOnce();
    expect(deps.search.mock.calls[0][0].query).toContain("主流");
    expect(deps.search.mock.calls[0][0].query).toContain("最常用");
    expect(deps.search.mock.calls[0][0].query).toContain("知名品牌");
    expect(deps.search.mock.calls[0][0].query).toContain("市场份额");
    expect(deps.search.mock.calls[0][0].query).toContain("用户规模");
  });

  it("allows one replacement and removes products on the exclusion list", async () => {
    const deps = dependencies({ products: [
      { name: "旧产品", region: "domestic", reason: "旧候选", sourceIds: ["R1"] },
      { name: "新产品", region: "domestic", reason: "新候选", sourceIds: ["R2"] },
    ] });
    const found = await discoverProducts({
      category: "办公软件",
      count: 1,
      scope: "domestic",
      excludeProducts: ["旧产品"],
    }, deps);
    expect(found.products.map((product) => product.name)).toEqual(["新产品"]);
    expect(deps.selector.select).toHaveBeenCalledWith(expect.objectContaining({
      excludeProducts: ["旧产品"],
    }));
  });

  it("uses two searches and enforces mixed regions for global scope", async () => {
    const deps = dependencies({ products: [
      { name: "产品甲", region: "domestic", reason: "国内代表产品", sourceIds: ["R1"] },
      { name: "Product B", region: "overseas", reason: "海外代表产品", sourceIds: ["R3"] },
    ] });
    const found = await discoverProducts({ category: "AI 产品", count: 3, scope: "global" }, deps);
    expect(found.searchCount).toBe(2);
    expect(found.partial).toBe(true);
    expect(deps.search).toHaveBeenCalledTimes(2);
    expect(deps.search.mock.calls[1][0].query).toContain("market share");
    expect(deps.search.mock.calls[1][0].query).toContain("most used");
  });

  it("keeps a mixed global selection even when the overseas candidate is ranked later", async () => {
    const deps = dependencies({ products: [
      { name: "产品甲", region: "domestic", reason: "国内代表产品", sourceIds: ["R1"] },
      { name: "产品乙", region: "domestic", reason: "国内代表产品", sourceIds: ["R2"] },
      { name: "Product C", region: "overseas", reason: "海外代表产品", sourceIds: ["R3"] },
    ] });
    const found = await discoverProducts({ category: "AI 产品", count: 2, scope: "global" }, deps);
    expect(new Set(found.products.map((product) => product.region))).toEqual(new Set(["domestic", "overseas"]));
  });

  it("rejects a global result from only one region", async () => {
    const deps = dependencies({ products: [
      { name: "产品甲", region: "domestic", reason: "国内产品", sourceIds: ["R1"] },
      { name: "产品乙", region: "domestic", reason: "国内产品", sourceIds: ["R2"] },
    ] });
    await expect(discoverProducts({ category: "AI 产品", count: 2, scope: "global" }, deps))
      .rejects.toThrow("同时找到国内和海外产品");
  });

  it("rejects invented source references and fewer than two valid products", async () => {
    const invented = dependencies({ products: [
      { name: "产品甲", region: "domestic", reason: "无依据", sourceIds: ["R99"] },
      { name: "产品乙", region: "domestic", reason: "有依据", sourceIds: ["R2"] },
    ] });
    await expect(discoverProducts({ category: "AI 产品", count: 2, scope: "domestic" }, invented))
      .rejects.toThrow("不存在的搜索结果");

    const insufficient = dependencies({ products: [
      { name: "产品甲", region: "domestic", reason: "唯一候选", sourceIds: ["R1"] },
    ] });
    await expect(discoverProducts({ category: "AI 产品", count: 2, scope: "domestic" }, insufficient))
      .rejects.toThrow("至少 2 个");
  });

  it("requires an enabled search provider", async () => {
    const deps = dependencies({ products: [] });
    await expect(discoverProducts(
      { category: "AI 产品", count: 2, scope: "domestic" },
      { ...deps, searchProvider: { name: "disabled", search: deps.search } },
    )).rejects.toThrow("需要启用 Brave 搜索");
  });
});
