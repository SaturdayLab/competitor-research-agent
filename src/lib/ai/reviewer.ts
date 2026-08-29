import { z } from "zod";

import type { ResearchDraft, ResearchEvidence, ResearchSource, ResearchTask } from "@/lib/domain/research";
import type { ResearchAnalysis } from "@/lib/ai/analyst";

export const ReviewResultSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  notes: z.array(z.string().trim().min(1).max(500)).max(12),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export type ReviewInput = {
  task: Pick<ResearchTask, "topic" | "competitors"> & { focus?: string | null };
  draft: ResearchDraft;
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
  dimensions?: string[];
  analysis?: ResearchAnalysis;
};

export interface ResearchReviewer {
  readonly name: string;
  review(input: ReviewInput): Promise<unknown>;
}

export function getReviewMaxRevisions(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(environment.REVIEW_MAX_REVISIONS ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.trunc(parsed), 0), 2);
}

export class DisabledResearchReviewer implements ResearchReviewer {
  readonly name = "disabled";

  async review(input: ReviewInput): Promise<ReviewResult> {
    void input;
    return { verdict: "pass", notes: [] };
  }
}
