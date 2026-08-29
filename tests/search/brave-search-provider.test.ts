import { afterEach, describe, expect, it, vi } from "vitest";

import { BraveSearchProvider } from "@/lib/search/brave-search-provider";
import { createSearchProvider, getSearchResultCount } from "@/lib/search/factory";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BraveSearchProvider", () => {
  it("maps validated web results and sends the API key only as a header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Cursor pricing",
                url: "https://cursor.com/pricing?utm_source=search",
                description: "Plans for individuals and teams.",
              },
              {
                title: "Cursor pricing duplicate",
                url: "https://cursor.com/pricing/",
                description: "Duplicate URL.",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new BraveSearchProvider("secret-key", { fetch: fetchMock, timeoutMs: 500 });

    const results = await provider.search({ query: "Cursor official pricing", count: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Cursor pricing",
      canonicalUrl: "https://cursor.com/pricing",
      snippet: "Plans for individuals and teams.",
      rank: 1,
    });
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.search.brave.com/res/v1/web/search",
    );
    expect(requestUrl.searchParams.get("q")).toBe("Cursor official pricing");
    expect(requestUrl.searchParams.get("count")).toBe("5");
    expect(requestUrl.searchParams.get("safesearch")).toBe("strict");
    expect(requestUrl.toString()).not.toContain("secret-key");
    expect(new Headers(requestInit.headers).get("X-Subscription-Token")).toBe("secret-key");
  });

  it("reports HTTP and response validation failures", async () => {
    const httpFailure = new BraveSearchProvider("key", {
      fetch: vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
    });
    await expect(httpFailure.search({ query: "test", count: 5 })).rejects.toThrow(
      "Brave Search 请求失败（429）",
    );

    const invalidPayload = new BraveSearchProvider("key", {
      fetch: vi.fn().mockResolvedValue(Response.json({ web: { results: [{ title: 3 }] } })),
    });
    await expect(invalidPayload.search({ query: "test", count: 5 })).rejects.toThrow(
      "Brave Search 返回了无效数据",
    );
  });

  it("caps the result count at twenty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ web: { results: [] } }));
    const provider = new BraveSearchProvider("key", { fetch: fetchMock });

    await provider.search({ query: "test", count: 99 });

    const [requestUrl] = fetchMock.mock.calls[0] as [URL];
    expect(requestUrl.searchParams.get("count")).toBe("20");
  });

  it("falls back to the HTTPS transport for a network failure but not an HTTP failure", async () => {
    const transientFetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));
    const fallbackFetch = vi.fn().mockResolvedValueOnce(Response.json({ web: { results: [] } }));
    const provider = new BraveSearchProvider("key", { fetch: transientFetch, fallbackFetch });
    await expect(provider.search({ query: "test", count: 2 })).resolves.toEqual([]);
    expect(transientFetch).toHaveBeenCalledOnce();
    expect(fallbackFetch).toHaveBeenCalledOnce();

    const httpFetch = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const unusedFallback = vi.fn();
    const httpProvider = new BraveSearchProvider("key", { fetch: httpFetch, fallbackFetch: unusedFallback });
    await expect(httpProvider.search({ query: "test", count: 2 })).rejects.toThrow("429");
    expect(httpFetch).toHaveBeenCalledOnce();
    expect(unusedFallback).not.toHaveBeenCalled();
  });
});

describe("createSearchProvider", () => {
  it("keeps search disabled by default and requires a key for Brave", () => {
    expect(createSearchProvider({}).name).toBe("disabled");
    expect(() => createSearchProvider({ SEARCH_PROVIDER: "brave" })).toThrow(
      "BRAVE_SEARCH_API_KEY",
    );
    expect(
      createSearchProvider({ SEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "key" }).name,
    ).toBe("brave");
  });

  it("bounds the configured search result count", () => {
    expect(getSearchResultCount({})).toBe(5);
    expect(getSearchResultCount({ SEARCH_RESULT_COUNT: "99" })).toBe(20);
    expect(getSearchResultCount({ SEARCH_RESULT_COUNT: "0" })).toBe(1);
  });
});
