import { NextResponse } from "next/server";

import { CreateResearchInputSchema } from "@/lib/domain/research";
import { apiError } from "@/lib/http/api-response";
import { getResearchRepository } from "@/lib/research/repository-factory";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = CreateResearchInputSchema.parse(await request.json());
    const task = await getResearchRepository().createTask(input);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
    const tasks = await getResearchRepository().listTasks(limit);
    return NextResponse.json({ tasks });
  } catch (error) {
    return apiError(error);
  }
}
