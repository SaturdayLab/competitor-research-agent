import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin-session";
import { apiError } from "@/lib/http/api-response";
import { getResearchRepository } from "@/lib/research/repository-factory";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const authError = requireAdmin(_request);
    if (authError) return authError;
    const { id } = await context.params;
    const repository = getResearchRepository();
    const task = await repository.getTask(id);
    if (!task) return NextResponse.json({ error: "调研任务不存在" }, { status: 404 });
    if (task.status === "queued" || task.status === "running") {
      return NextResponse.json({ error: "该任务已在队列或正在执行" }, { status: 409 });
    }

    const run = await repository.enqueueTask(id);
    return NextResponse.json({ task: await repository.getTask(id), run }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
