import type { GapQueryInput, GapQueryPlanner } from "@/lib/ai/gap-investigator";

export class DemoGapQueryPlanner implements GapQueryPlanner {
  readonly name = "demo";
  async plan(input: GapQueryInput): Promise<unknown> {
    return { queries: input.gaps.map((gap) => ({ ...gap, query: `${gap.product} ${gap.dimension} ${input.topic}`.slice(0, 240) })) };
  }
}
