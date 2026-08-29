import { request as httpsRequest } from "node:https";

import { z } from "zod";

import type { SearchProvider, SearchQuery, SearchResult } from "@/lib/search/provider";
import { deduplicateSearchResults } from "@/lib/search/url";

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string().trim().min(1),
          url: z.string().trim().min(1),
          description: z.string().trim().default(""),
        }),
      ),
    })
    .optional(),
});

interface BraveSearchOptions {
  fetch?: typeof fetch;
  fallbackFetch?: typeof fetch;
  timeoutMs?: number;
}

const httpsFallbackFetch: typeof fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
          else if (value !== undefined) headers.set(name, String(value));
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500, headers }));
      });
    });
    const abort = () => request.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error("请求已取消"));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    request.on("error", reject);
    request.end();
  });
};

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";
  private readonly fetchImpl: typeof fetch;
  private readonly fallbackFetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: BraveSearchOptions = {},
  ) {
    if (!apiKey.trim()) throw new Error("BRAVE_SEARCH_API_KEY 不能为空");
    this.fetchImpl = options.fetch ?? fetch;
    this.fallbackFetchImpl = options.fallbackFetch ?? httpsFallbackFetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async search(input: SearchQuery): Promise<SearchResult[]> {
    const query = input.query.trim();
    if (!query) throw new Error("搜索关键词不能为空");
    const count = Math.min(Math.max(input.count ?? 5, 1), 20);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("safesearch", "strict");

    const requestInit: RequestInit = {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    let response: Response;
    try {
      response = await this.fetchImpl(url, requestInit);
    } catch (primaryError) {
      try {
        response = await this.fallbackFetchImpl(url, {
          ...requestInit,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (fallbackError) {
        const networkError = fallbackError ?? primaryError;
        if (networkError instanceof Error && (networkError.name === "TimeoutError" || networkError.name === "AbortError")) {
          throw new Error(`Brave Search 请求超时（${this.timeoutMs}ms，备用传输也失败）`, { cause: networkError });
        }
        throw new Error("Brave Search 网络请求失败（备用传输也失败）", { cause: networkError });
      }
    }

    if (!response.ok) throw new Error(`Brave Search 请求失败（${response.status}）`);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("Brave Search 返回了无效 JSON", { cause: error });
    }
    const parsed = braveResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Brave Search 返回了无效数据");

    return deduplicateSearchResults(
      (parsed.data.web?.results ?? []).slice(0, count).map((result, index) => ({
        title: result.title,
        url: result.url,
        snippet: result.description,
        rank: index + 1,
      })),
    );
  }
}
