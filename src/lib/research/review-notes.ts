import { z } from "zod";

const StoredReviewOutputSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  notes: z.array(z.string().trim().min(1).max(500)).max(12),
  revisions: z.number().int().min(0).max(2),
});

export function readStoredReviewNotes(output: unknown): string[] {
  const parsed = StoredReviewOutputSchema.safeParse(output);
  return parsed.success ? parsed.data.notes : [];
}
