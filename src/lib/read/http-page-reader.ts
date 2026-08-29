import { extractTitle, htmlToText, MAX_EXTRACTED_CHARS } from "@/lib/read/html-text";
import type { PageReadResult, PageReader } from "@/lib/read/page-reader";
import { assertPublicHttpUrl, defaultLookup, type LookupFn } from "@/lib/read/ssrf";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_REDIRECTS = 3;
const ALLOWED_TYPES = new Set(["text/html", "text/plain"]);

export interface HttpPageReaderOptions {
  fetch?: typeof fetch;
  lookup?: LookupFn;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxChars?: number;
}

function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function fail(url: string, reason: string): PageReadResult {
  return { ok: false, url, reason };
}

export class HttpPageReader implements PageReader {
  readonly name = "http";
  private readonly fetchImpl: typeof fetch;
  private readonly lookup: LookupFn;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly maxChars: number;

  constructor(options: HttpPageReaderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.lookup = options.lookup ?? defaultLookup;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxChars = options.maxChars ?? MAX_EXTRACTED_CHARS;
  }

  async read(url: string): Promise<PageReadResult> {
    return this.readAt(url, url, 0);
  }

  private async readAt(originalUrl: string, currentUrl: string, hops: number): Promise<PageReadResult> {
    const ssrf = await assertPublicHttpUrl(currentUrl, this.lookup);
    if (!ssrf.ok) return fail(originalUrl, ssrf.reason);

    let response: Response;
    try {
      response = await this.fetchImpl(ssrf.url, {
        redirect: "manual",
        headers: {
          Accept: "text/html, text/plain;q=0.9",
          "User-Agent": "ResearchAgent/0.1 (+local worker)",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return fail(originalUrl, `读取页面超时（${this.timeoutMs}ms）`);
      }
      return fail(originalUrl, "读取页面失败");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hops >= this.maxRedirects) return fail(originalUrl, "跳转次数超过限制");
      const location = response.headers.get("location");
      if (!location) return fail(originalUrl, "跳转响应缺少 Location");
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, ssrf.url);
      } catch {
        return fail(originalUrl, "跳转地址无效");
      }
      return this.readAt(originalUrl, nextUrl.toString(), hops + 1);
    }

    if (response.status < 200 || response.status >= 300) {
      return fail(originalUrl, `读取页面失败（${response.status}）`);
    }

    const contentType = mediaType(response.headers.get("content-type"));
    if (!ALLOWED_TYPES.has(contentType)) {
      return fail(originalUrl, `不支持的内容类型：${contentType || "未知"}`);
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      return fail(originalUrl, "页面体积过大");
    }

    let body: string;
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > this.maxBytes) return fail(originalUrl, "页面体积过大");
      body = buffer.toString("utf8");
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return fail(originalUrl, `读取页面超时（${this.timeoutMs}ms）`);
      }
      return fail(originalUrl, "读取页面正文失败");
    }

    const title = contentType === "text/html" ? extractTitle(body) : "";
    const text = contentType === "text/html" ? htmlToText(body, this.maxChars) : body.replace(/\s+/g, " ").trim().slice(0, this.maxChars);
    if (!text) return fail(originalUrl, "页面没有可读正文");

    return {
      ok: true,
      url: originalUrl,
      finalUrl: ssrf.url.toString(),
      title: title || text.slice(0, 80),
      text,
      contentType,
      status: response.status,
    };
  }
}
