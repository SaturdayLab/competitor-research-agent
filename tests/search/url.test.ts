import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl,
  deduplicateSearchResults,
  publicSourceHref,
  sourceDomain,
} from "@/lib/search/url";

describe("canonicalizeUrl", () => {
  it("normalizes hosts, tracking parameters, fragments, query order, and trailing slashes", () => {
    expect(
      canonicalizeUrl(
        "HTTPS://Example.COM/pricing/?utm_source=newsletter&b=2&a=1#enterprise",
      ),
    ).toBe("https://example.com/pricing?a=1&b=2");
  });

  it("preserves the root slash and rejects non-http protocols", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("deduplicateSearchResults", () => {
  it("keeps the first result for each canonical URL", () => {
    const results = deduplicateSearchResults([
      {
        title: "Pricing",
        url: "https://example.com/pricing?utm_campaign=launch",
        snippet: "First",
        rank: 1,
      },
      {
        title: "Pricing duplicate",
        url: "https://EXAMPLE.com/pricing/",
        snippet: "Second",
        rank: 2,
      },
      {
        title: "Docs",
        url: "https://example.com/docs",
        snippet: "Third",
        rank: 3,
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.canonicalUrl)).toEqual([
      "https://example.com/pricing",
      "https://example.com/docs",
    ]);
    expect(results[0].title).toBe("Pricing");
  });
});

describe("publicSourceHref", () => {
  it("allows only http and https links", () => {
    expect(publicSourceHref("https://cursor.com/pricing")).toBe("https://cursor.com/pricing");
    expect(publicSourceHref("http://example.com")).toBe("http://example.com/");
    expect(publicSourceHref("javascript:alert(1)")).toBeNull();
    expect(publicSourceHref("not a url")).toBeNull();
  });
});

describe("sourceDomain", () => {
  it("returns the hostname without a www prefix", () => {
    expect(sourceDomain("https://www.cursor.com/pricing")).toBe("cursor.com");
    expect(sourceDomain("https://docs.example.co.uk/path")).toBe("docs.example.co.uk");
    expect(sourceDomain("not a url")).toBe("not a url");
  });
});
