import { z } from "zod";

import { ConfigurationError } from "@/lib/errors";
import type { SearchProvider, SearchResult } from "@/lib/search/provider";

export const ProductRegionSchema = z.enum(["domestic", "overseas"]);
export type ProductRegion = z.infer<typeof ProductRegionSchema>;

export const DiscoveryScopeSchema = z.enum(["domestic", "overseas", "global"]);
export type DiscoveryScope = z.infer<typeof DiscoveryScopeSchema>;

export const ProductDiscoveryRequestSchema = z.object({
  category: z.string().trim().min(2, "产品类别至少需要 2 个字符").max(100, "产品类别不能超过 100 个字符"),
  count: z.number().int().min(1, "至少选择 1 个产品").max(6, "最多选择 6 个产品").default(3),
  scope: DiscoveryScopeSchema.default("global"),
  excludeProducts: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});
export type ProductDiscoveryRequest = z.infer<typeof ProductDiscoveryRequestSchema>;

export const DiscoverySourceSchema = z.object({
  id: z.string().regex(/^R\d+$/),
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
  snippet: z.string(),
  regionHint: ProductRegionSchema,
});
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;

export const DiscoveredProductSchema = z.object({
  name: z.string().trim().min(1).max(80),
  region: ProductRegionSchema,
  reason: z.string().trim().min(1).max(300),
  sourceIds: z.array(z.string().regex(/^R\d+$/)).min(1).max(3),
});
export type DiscoveredProduct = z.infer<typeof DiscoveredProductSchema>;

export const ProductSelectionSchema = z.object({
  products: z.array(DiscoveredProductSchema).min(1).max(12),
});

export interface ProductSelector {
  readonly name: string;
  select(input: {
    category: string;
    count: number;
    scope: DiscoveryScope;
    excludeProducts: string[];
    sources: DiscoverySource[];
  }): Promise<unknown>;
}

export type ProductDiscoveryResult = {
  products: DiscoveredProduct[];
  requestedCount: number;
  partial: boolean;
  searchCount: number;
};

function discoveryQueries(request: ProductDiscoveryRequest): Array<{ query: string; regionHint: ProductRegion }> {
  if (request.scope === "domestic") {
    return [{
      query: `${request.category} 中国 主流 最常用 知名品牌 用户规模 市场份额 排行榜`,
      regionHint: "domestic",
    }];
  }
  if (request.scope === "overseas") {
    return [{
      query: `${request.category} leading popular market share most used products ranking`,
      regionHint: "overseas",
    }];
  }
  return [
    {
      query: `${request.category} 中国 主流 最常用 知名品牌 用户规模 市场份额 排行榜`,
      regionHint: "domestic",
    },
    {
      query: `${request.category} leading popular market share most used products ranking`,
      regionHint: "overseas",
    },
  ];
}

function numberedSources(results: Array<{ result: SearchResult; regionHint: ProductRegion }>): DiscoverySource[] {
  return results.map(({ result, regionHint }, index) => ({
    id: `R${index + 1}`,
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    regionHint,
  }));
}

function normalizeProducts(
  raw: unknown,
  request: ProductDiscoveryRequest,
  sources: DiscoverySource[],
): DiscoveredProduct[] {
  const selection = ProductSelectionSchema.parse(raw);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const excluded = new Set(request.excludeProducts.map((name) => name.toLocaleLowerCase()));
  const candidates: DiscoveredProduct[] = [];

  for (const product of selection.products) {
    const normalized = product.name.toLocaleLowerCase();
    if (seen.has(normalized) || excluded.has(normalized)) continue;
    if (product.sourceIds.some((sourceId) => !sourcesById.has(sourceId))) {
      throw new Error(`自动选品引用了不存在的搜索结果：${product.name}`);
    }
    if (request.scope !== "global" && product.region !== request.scope) continue;
    seen.add(normalized);
    candidates.push(product);
  }

  if (candidates.length < Math.min(2, request.count)) {
    throw new Error(`没有找到至少 ${Math.min(2, request.count)} 个符合条件且有搜索依据的新产品，请调整类别或地域范围`);
  }
  let products = candidates.slice(0, request.count);
  if (request.scope === "global") {
    const domestic = candidates.find((product) => product.region === "domestic");
    const overseas = candidates.find((product) => product.region === "overseas");
    if (!domestic || !overseas) {
      throw new Error("全球范围需要同时找到国内和海外产品，请调整类别后重试");
    }
    if (!products.some((product) => product.region === "domestic")) {
      products = [...products.slice(0, -1), domestic];
    }
    if (!products.some((product) => product.region === "overseas")) {
      products = [...products.slice(0, -1), overseas];
    }
  }
  return products;
}

export async function discoverProducts(
  rawRequest: unknown,
  dependencies: { searchProvider: SearchProvider; selector: ProductSelector; resultCount?: number },
): Promise<ProductDiscoveryResult> {
  const request = ProductDiscoveryRequestSchema.parse(rawRequest);
  if (dependencies.searchProvider.name === "disabled") {
    throw new ConfigurationError("自动发现产品需要启用 Brave 搜索。");
  }

  const queries = discoveryQueries(request);
  const batches = await Promise.all(
    queries.map(async ({ query, regionHint }) => ({
      regionHint,
      results: await dependencies.searchProvider.search({ query, count: dependencies.resultCount ?? 10 }),
    })),
  );
  const sources = numberedSources(
    batches.flatMap((batch) => batch.results.map((result) => ({ result, regionHint: batch.regionHint }))),
  );
  if (sources.length === 0) throw new Error("自动选品搜索没有返回结果，请稍后重试");

  const rawSelection = await dependencies.selector.select({ ...request, sources });
  const products = normalizeProducts(rawSelection, request, sources);
  return {
    products,
    requestedCount: request.count,
    partial: products.length < request.count,
    searchCount: queries.length,
  };
}
