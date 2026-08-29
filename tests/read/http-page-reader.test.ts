import { describe, expect, it, vi } from "vitest";

import { HttpPageReader } from "@/lib/read/http-page-reader";
import { htmlToText } from "@/lib/read/html-text";

const publicLookup = async () => ["93.184.216.34"];

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
    ...init,
  });
}

describe("htmlToText", () => {
  it("strips script and style blocks and truncates", () => {
    const text = htmlToText(
      "<html><script>alert(1)</script><style>h1{color:red}</style><h1>Plans</h1><p>Hobby</p></html>",
      20,
    );
    expect(text).not.toContain("alert");
    expect(text).toContain("Plans");
    expect(text.length).toBeLessThanOrEqual(20);
  });
});

describe("HttpPageReader", () => {
  it("extracts title and visible text from HTML", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      htmlResponse(
        "<html><head><title>Cursor Pricing</title><script>secret()</script></head><body><p>Hobby and Business.</p></body></html>",
      ),
    );
    const reader = new HttpPageReader({ fetch: fetchMock, lookup: publicLookup });
    const result = await reader.read("https://example.com/pricing");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe("Cursor Pricing");
    expect(result.text).toContain("Hobby and Business.");
    expect(result.text).not.toContain("secret");
    expect(result.status).toBe(200);
    expect(result.finalUrl).toBe("https://example.com/pricing");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("skips timeouts, non-2xx, oversize, and disallowed content types", async () => {
    const timeout = new HttpPageReader({
      lookup: publicLookup,
      fetch: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
    });
    const timedOut = await timeout.read("https://example.com/slow");
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.reason).toMatch(/超时/);

    const notFound = new HttpPageReader({
      lookup: publicLookup,
      fetch: vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    });
    expect((await notFound.read("https://example.com/404")).ok).toBe(false);

    const oversize = new HttpPageReader({
      lookup: publicLookup,
      maxBytes: 32,
      fetch: vi.fn().mockResolvedValue(
        htmlResponse("too-large", { headers: { "content-type": "text/html", "content-length": "9999" } }),
      ),
    });
    const large = await oversize.read("https://example.com/big");
    expect(large.ok).toBe(false);
    if (!large.ok) expect(large.reason).toMatch(/体积|过大/);

    const json = new HttpPageReader({
      lookup: publicLookup,
      fetch: vi.fn().mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    });
    expect((await json.read("https://example.com/api")).ok).toBe(false);
  });

  it("does not follow a redirect to a private address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      }),
    );
    const reader = new HttpPageReader({ fetch: fetchMock, lookup: publicLookup, maxRedirects: 3 });
    const result = await reader.read("https://example.com/out");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/私网|本机|拒绝/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
