import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

export const ADMIN_SESSION_COOKIE = "cra_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

type AdminAuthConfig = { password: string; sessionSecret: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function passwordsMatch(candidate: string, expected: string): boolean {
  return timingSafeEqual(digest(candidate), digest(expected));
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function createAdminSessionToken(
  secret: string,
  now = Date.now(),
  expiresAt = now + ADMIN_SESSION_MAX_AGE_SECONDS * 1_000,
): string {
  const payload = `${expiresAt}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyAdminSessionToken(token: string, secret: string, now = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [rawExpiry, nonce, providedSignature] = parts;
  const expiry = Number(rawExpiry);
  if (!Number.isFinite(expiry) || expiry <= now || !nonce || !providedSignature) return false;
  const expectedSignature = signature(`${rawExpiry}.${nonce}`, secret);
  return timingSafeEqual(digest(providedSignature), digest(expectedSignature));
}

export function getAdminAuthConfig(): AdminAuthConfig | null {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? "";
  if (password.length < 12 || sessionSecret.length < 32) return null;
  return { password, sessionSecret };
}

function requestCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export function isAdminRequestAuthenticated(request: Request): boolean {
  const config = getAdminAuthConfig();
  const token = requestCookie(request, ADMIN_SESSION_COOKIE);
  return Boolean(config && token && verifyAdminSessionToken(token, config.sessionSecret));
}

export function requireAdmin(request: Request): NextResponse | null {
  if (!getAdminAuthConfig()) {
    return NextResponse.json({ error: "管理员访问尚未配置" }, { status: 503 });
  }
  if (!isAdminRequestAuthenticated(request)) {
    return NextResponse.json({ error: "此操作需要管理员密码确认" }, { status: 401 });
  }
  return null;
}

export function requestOriginIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

type LimiterEntry = { count: number; resetAt: number };

export class AdminLoginLimiter {
  private readonly entries = new Map<string, LimiterEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: { maxAttempts: number; windowMs: number; now?: () => number }) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  consume(key: string): boolean {
    const now = this.now();
    const existing = this.entries.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : existing;
    if (entry.count >= this.maxAttempts) return false;
    entry.count += 1;
    this.entries.set(key, entry);
    return true;
  }

  reset(key: string) {
    this.entries.delete(key);
  }
}
