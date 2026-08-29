import { NextResponse } from "next/server";

import { getProductSelector } from "@/lib/ai/factory";
import {
  discoverProducts,
  ProductDiscoveryRequestSchema,
  type ProductDiscoveryResult,
} from "@/lib/ai/product-discovery";
import { TtlCache } from "@/lib/cache/ttl-cache";
import { apiError } from "@/lib/http/api-response";
import { createSearchProvider, getSearchResultCount } from "@/lib/search/factory";

export const runtime = "nodejs";

const discoveryCache = new TtlCache<string, ProductDiscoveryResult>({
  ttlMs: 15 * 60 * 1_000,
  maxEntries: 100,
});

function cacheKey(request: ReturnType<typeof ProductDiscoveryRequestSchema.parse>) {
  return JSON.stringify({
    category: request.category.toLocaleLowerCase(),
    count: request.count,
    scope: request.scope,
    excludeProducts: [...request.excludeProducts].map((name) => name.toLocaleLowerCase()).sort(),
  });
}

export async function POST(request: Request) {
  try {
    const input = ProductDiscoveryRequestSchema.parse(await request.json());
    const cached = await discoveryCache.getOrCreate(cacheKey(input), () => discoverProducts(input, {
        searchProvider: createSearchProvider(),
        selector: getProductSelector(),
        resultCount: Math.max(getSearchResultCount(), 10),
      }));
    return NextResponse.json({
      ...cached.value,
      cached: cached.hit,
    });
  } catch (error) {
    return apiError(error);
  }
}
