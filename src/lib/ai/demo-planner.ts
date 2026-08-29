import type { ResearchPlan, ResearchPlanInput, ResearchPlanner } from "@/lib/ai/planner";

const FALLBACK_DIMENSIONS = ["产品定位", "核心能力", "适用人群", "定价", "集成生态"];

function focusTokens(focus?: string | null): string[] {
  if (!focus) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const item of focus.split(/[，,、;；]/)) {
    const token = item.trim().slice(0, 100);
    const normalized = token.toLocaleLowerCase();
    if (!token || seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(token);
    if (tokens.length >= 6) break;
  }
  return tokens;
}

export class DemoResearchPlanner implements ResearchPlanner {
  readonly name = "demo";

  async plan(input: ResearchPlanInput): Promise<ResearchPlan> {
    const dimensions = focusTokens(input.focus);
    const seen = new Set(dimensions.map((item) => item.toLocaleLowerCase()));
    for (const fallback of FALLBACK_DIMENSIONS) {
      if (dimensions.length >= 3) break;
      if (seen.has(fallback.toLocaleLowerCase())) continue;
      dimensions.push(fallback);
      seen.add(fallback.toLocaleLowerCase());
    }
    const firstFocus = focusTokens(input.focus)[0];

    return {
      dimensions,
      searchQueries: input.competitors.map((product) => ({
        product,
        query: [product, input.topic, firstFocus].filter(Boolean).join(" ").slice(0, 160),
      })),
      rationale: "分析维度由本次主题与用户关注点生成，不使用预置品类模板。",
    };
  }
}
