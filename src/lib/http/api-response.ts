import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ConfigurationError, toErrorMessage } from "@/lib/errors";

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "请求参数无效",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (error instanceof ConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  console.error("API request failed", error);
  return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
}
