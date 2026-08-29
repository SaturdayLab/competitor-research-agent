import { NextResponse } from "next/server";

import { apiError } from "@/lib/http/api-response";
import { getResearchRepository } from "@/lib/research/repository-factory";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const detail = await getResearchRepository().getTaskDetail(id);
    if (!detail) return NextResponse.json({ error: "调研任务不存在" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return apiError(error);
  }
}
