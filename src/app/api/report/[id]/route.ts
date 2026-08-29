import { NextResponse } from "next/server";

import { apiError } from "@/lib/http/api-response";
import { readStoredReviewNotes } from "@/lib/research/review-notes";
import { getResearchRepository } from "@/lib/research/repository-factory";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const repository = getResearchRepository();
    const report = await repository.getReport(id);
    if (!report) return NextResponse.json({ error: "报告尚未生成" }, { status: 404 });
    const bundle = await repository.getRunBundle(report.runId);
    const reviewStep = bundle?.steps.findLast((step) => step.stepType === "reviewing");
    const reviewNotes = readStoredReviewNotes(reviewStep?.output);
    return NextResponse.json({
      report,
      sources: bundle?.sources ?? [],
      evidence: bundle?.evidence ?? [],
      reviewNotes,
    });
  } catch (error) {
    return apiError(error);
  }
}
