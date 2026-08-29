import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  getAdminAuthConfig,
  isAdminRequestAuthenticated,
  requestOriginIsAllowed,
} from "@/lib/auth/admin-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return NextResponse.json({
    authenticated: isAdminRequestAuthenticated(request),
    configured: Boolean(getAdminAuthConfig()),
  });
}

export async function DELETE(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
