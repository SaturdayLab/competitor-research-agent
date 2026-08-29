import { afterEach, describe, expect, it } from "vitest";

import {
  AdminLoginLimiter,
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  passwordsMatch,
  requestOriginIsAllowed,
  requireAdmin,
  verifyAdminSessionToken,
} from "@/lib/auth/admin-session";

describe("admin session", () => {
  const secret = "s".repeat(32);

  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  it("accepts a valid token and rejects expired or modified tokens", () => {
    const token = createAdminSessionToken(secret, 1_000, 8_000);
    expect(verifyAdminSessionToken(token, secret, 2_000)).toBe(true);
    expect(verifyAdminSessionToken(token, secret, 9_001)).toBe(false);
    expect(verifyAdminSessionToken(`${token}x`, secret, 2_000)).toBe(false);
  });

  it("compares passwords without accepting partial or different values", () => {
    expect(passwordsMatch("correct horse", "correct horse")).toBe(true);
    expect(passwordsMatch("correct", "correct horse")).toBe(false);
  });

  it("limits repeated failed login attempts and resets after success", () => {
    let now = 1_000;
    const limiter = new AdminLoginLimiter({ maxAttempts: 2, windowMs: 100, now: () => now });
    expect(limiter.consume("client")).toBe(true);
    expect(limiter.consume("client")).toBe(true);
    expect(limiter.consume("client")).toBe(false);
    limiter.reset("client");
    expect(limiter.consume("client")).toBe(true);
    now = 1_101;
    expect(limiter.consume("other")).toBe(true);
  });

  it("fails closed when auth is unconfigured and accepts only a signed cookie", () => {
    const request = new Request("https://example.com/api/research", { method: "POST" });
    expect(requireAdmin(request)?.status).toBe(503);

    process.env.ADMIN_PASSWORD = "a-secure-admin-password";
    process.env.ADMIN_SESSION_SECRET = secret;
    expect(requireAdmin(request)?.status).toBe(401);

    const token = createAdminSessionToken(secret);
    const authenticated = new Request("https://example.com/api/research", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
      method: "POST",
    });
    expect(requireAdmin(authenticated)).toBeNull();
  });

  it("rejects a cross-origin mutation", () => {
    const request = new Request("https://example.com/api/admin/login", {
      headers: { origin: "https://attacker.example" },
      method: "POST",
    });
    expect(requestOriginIsAllowed(request)).toBe(false);
  });
});
