import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as login } from "@/app/api/admin/login/route";
import { GET as session } from "@/app/api/admin/session/route";
import { POST as createResearch } from "@/app/api/research/route";
import { POST as discoverProducts } from "@/app/api/research/discover-products/route";
import { POST as rerunResearch } from "@/app/api/research/[id]/run/route";

describe("admin protected routes", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "a-secure-admin-password";
    process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
  });

  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  it("sets a hardened HttpOnly cookie after a successful login", async () => {
    const response = await login(new Request("https://example.com/api/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "x-forwarded-for": "198.51.100.10",
      },
      body: JSON.stringify({ password: "a-secure-admin-password" }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("cra_admin_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(await response.json()).toEqual({ authenticated: true });

    const cookieHeader = cookie.split(";")[0];
    const sessionResponse = await session(new Request("https://example.com/api/admin/session", {
      headers: { cookie: cookieHeader },
    }));
    expect(await sessionResponse.json()).toEqual({ authenticated: true, configured: true });
  });

  it("rejects wrong passwords and cross-origin login attempts", async () => {
    const wrong = await login(new Request("https://example.com/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11" },
      body: JSON.stringify({ password: "wrong-password" }),
    }));
    expect(wrong.status).toBe(401);

    const crossOrigin = await login(new Request("https://example.com/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ password: "a-secure-admin-password" }),
    }));
    expect(crossOrigin.status).toBe(403);
  });

  it("blocks every paid operation before business work starts", async () => {
    const createResponse = await createResearch(new Request("https://example.com/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "测试调研", competitors: ["A", "B"] }),
    }));
    expect(createResponse.status).toBe(401);

    const discoveryResponse = await discoverProducts(new Request("https://example.com/api/research/discover-products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "办公软件", count: 2, scope: "domestic" }),
    }));
    expect(discoveryResponse.status).toBe(401);

    const rerunResponse = await rerunResearch(
      new Request("https://example.com/api/research/task-1/run", { method: "POST" }),
      { params: Promise.resolve({ id: "task-1" }) },
    );
    expect(rerunResponse.status).toBe(401);
  });
});
