import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  AdminLoginLimiter,
  createAdminSessionToken,
  getAdminAuthConfig,
  passwordsMatch,
  requestOriginIsAllowed,
} from "@/lib/auth/admin-session";
import { apiError } from "@/lib/http/api-response";

export const runtime = "nodejs";

const LoginSchema = z.object({ password: z.string().min(1).max(200) });
const limiter = new AdminLoginLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1_000 });

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || request.headers.get("x-real-ip")
    || "local";
}

export async function POST(request: Request) {
  try {
    if (!requestOriginIsAllowed(request)) {
      return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
    }
    const key = clientKey(request);
    if (!limiter.consume(key)) {
      return NextResponse.json({ error: "密码尝试次数过多，请稍后再试" }, { status: 429 });
    }
    const config = getAdminAuthConfig();
    if (!config) {
      return NextResponse.json({ error: "管理员访问尚未配置" }, { status: 503 });
    }
    const { password } = LoginSchema.parse(await request.json());
    if (!passwordsMatch(password, config.password)) {
      return NextResponse.json({ error: "管理员密码不正确" }, { status: 401 });
    }

    limiter.reset(key);
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(config.sessionSecret), {
      httpOnly: true,
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
