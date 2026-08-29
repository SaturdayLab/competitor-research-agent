import { z } from "zod";

export type ResearchPlanInput = {
  topic: string;
  competitors: string[];
  focus?: string | null;
};

export const PlannedSearchQuerySchema = z.object({
  product: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(160),
});
export type PlannedSearchQuery = z.infer<typeof PlannedSearchQuerySchema>;

export const ResearchPlanSchema = z
  .object({
    dimensions: z.array(z.string().trim().min(1).max(100)).min(3).max(8),
    searchQueries: z.array(PlannedSearchQuerySchema).min(2).max(6),
    rationale: z.string().trim().min(1).max(500),
  })
  .superRefine((plan, context) => {
    const seen = new Set<string>();
    for (const dimension of plan.dimensions) {
      const normalized = dimension.toLocaleLowerCase();
      if (seen.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["dimensions"],
          message: "分析维度不能重复",
        });
        return;
      }
      seen.add(normalized);
    }
  });

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export interface ResearchPlanner {
  readonly name: string;
  plan(input: ResearchPlanInput): Promise<unknown>;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function assertResearchPlanCoverage(
  plan: ResearchPlan,
  input: ResearchPlanInput,
): void {
  if (plan.searchQueries.length !== input.competitors.length) {
    throw new Error("规划搜索词未完整覆盖全部竞品");
  }

  const expected = new Map(input.competitors.map((product) => [normalizeName(product), product]));
  const seen = new Set<string>();
  for (const item of plan.searchQueries) {
    const normalized = normalizeName(item.product);
    const original = expected.get(normalized);
    if (!original || seen.has(normalized)) {
      throw new Error("规划搜索词的竞品缺失、重复或包含额外产品");
    }
    if (!item.query.includes(original)) {
      throw new Error(`规划搜索词必须包含竞品原名：${original}`);
    }
    seen.add(normalized);
  }

  if (seen.size !== expected.size) throw new Error("规划搜索词未完整覆盖全部竞品");
}

const DEFAULT_DIMENSIONS = ["产品定位", "核心能力", "适用人群"];

export class DisabledResearchPlanner implements ResearchPlanner {
  readonly name = "disabled";

  async plan(input: ResearchPlanInput): Promise<ResearchPlan> {
    return {
      dimensions: DEFAULT_DIMENSIONS,
      searchQueries: input.competitors.map((product) => ({
        product,
        query: `${product} ${input.topic}`.slice(0, 160),
      })),
      rationale: "使用主题与通用分析维度生成基础研究计划。",
    };
  }
}
