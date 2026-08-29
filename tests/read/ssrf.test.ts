import { describe, expect, it } from "vitest";

import { assertPublicHttpUrl, isBlockedIp } from "@/lib/read/ssrf";

describe("isBlockedIp", () => {
  it("blocks loopback, private, link-local, and metadata addresses", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.8")).toBe(true);
    expect(isBlockedIp("172.16.4.1")).toBe(true);
    expect(isBlockedIp("192.168.1.20")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("100.64.1.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-http protocols and URLs with credentials", async () => {
    expect((await assertPublicHttpUrl("file:///etc/passwd")).ok).toBe(false);
    expect((await assertPublicHttpUrl("javascript:alert(1)")).ok).toBe(false);
    expect((await assertPublicHttpUrl("https://user:pass@example.com/docs")).ok).toBe(false);
    expect((await assertPublicHttpUrl("not a url")).ok).toBe(false);
  });

  it("rejects literal private and metadata addresses without DNS", async () => {
    expect((await assertPublicHttpUrl("http://127.0.0.1/admin")).ok).toBe(false);
    expect((await assertPublicHttpUrl("http://10.0.0.1/")).ok).toBe(false);
    expect((await assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).ok).toBe(false);
    expect((await assertPublicHttpUrl("http://[::1]/")).ok).toBe(false);
  });

  it("rejects hostnames that resolve to a blocked address", async () => {
    const decision = await assertPublicHttpUrl("https://internal.example/", async () => ["10.1.2.3"]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/私网|安全|拒绝/);
  });

  it("accepts https hosts that resolve only to public addresses", async () => {
    const decision = await assertPublicHttpUrl("https://Example.COM/pricing", async (hostname) => {
      expect(hostname).toBe("example.com");
      return ["93.184.216.34"];
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.url.hostname).toBe("example.com");
      expect(decision.addresses).toEqual(["93.184.216.34"]);
    }
  });
});
