import { describe, expect, it, vi } from "vitest";

import { DeepSeekResearchPlanner } from "@/lib/ai/deepseek-planner";
import { DemoResearchPlanner } from "@/lib/ai/demo-planner";
import {
  assertResearchPlanCoverage,
  DisabledResearchPlanner,
  ResearchPlanSchema,
  type ResearchPlanInput,
} from "@/lib/ai/planner";

const input: ResearchPlanInput = {
  topic: "协同办公",
  competitors: ["飞书", "钉钉", "企业微信"],
  focus: "文档协作，定价",
};

const validPlan = {
  dimensions: ["文档协作", "定价", "产品定位"],
  searchQueries: input.competitors.map((product) => ({ product, query: `${product} 协同办公` })),
  rationale: "围绕协作体验与商业模式比较。",
};

describe("ResearchPlanSchema", () => {
  it("accepts a complete plan", () => {
    const plan = ResearchPlanSchema.parse(validPlan);
    expect(() => assertResearchPlanCoverage(plan, input)).not.toThrow();
  });

  it("accepts a complete plan for two competitors", () => {
    const twoProductInput = { ...input, competitors: ["飞书", "钉钉"] };
    const plan = ResearchPlanSchema.parse({
      ...validPlan,
      searchQueries: twoProductInput.competitors.map((product) => ({ product, query: `${product} 协同办公` })),
    });
    expect(() => assertResearchPlanCoverage(plan, twoProductInput)).not.toThrow();
  });

  it.each([
    { ...validPlan, dimensions: ["定位", "能力"] },
    { ...validPlan, dimensions: Array.from({ length: 9 }, (_, index) => `维度${index}`) },
    { ...validPlan, dimensions: ["定位", "定位", "定价"] },
    { ...validPlan, searchQueries: validPlan.searchQueries.map((item, index) => index === 0 ? { ...item, query: "协同办公" } : item) },
    { ...validPlan, searchQueries: validPlan.searchQueries.slice(1) },
    { ...validPlan, searchQueries: [validPlan.searchQueries[0], validPlan.searchQueries[0], validPlan.searchQueries[2]] },
    { ...validPlan, searchQueries: validPlan.searchQueries.map((item, index) => index === 0 ? { product: "额外产品", query: "额外产品 协同办公" } : item) },
    { ...validPlan, searchQueries: validPlan.searchQueries.map((item, index) => index === 0 ? { ...item, query: "" } : item) },
  ])("rejects an invalid plan", (candidate) => {
    expect(() => {
      const plan = ResearchPlanSchema.parse(candidate);
      assertResearchPlanCoverage(plan, input);
    }).toThrow();
  });
});

describe("deterministic planners", () => {
  it("returns stable demo plans derived from the current input", async () => {
    const planner = new DemoResearchPlanner();
    const first = await planner.plan(input);
    expect(await planner.plan(input)).toEqual(first);
    expect(first.dimensions).toEqual(["文档协作", "定价", "产品定位"]);
    expect(JSON.stringify(first)).not.toMatch(/Coding Agent|IDE|代码库理解/);

    const music = await planner.plan({
      topic: "音乐流媒体",
      competitors: ["Spotify", "Apple Music", "QQ音乐"],
      focus: "曲库，音质",
    });
    expect(JSON.stringify(music)).not.toMatch(/Coding Agent|IDE|代码库理解/);
  });

  it("keeps the disabled planner equivalent to the original query formula", async () => {
    const plan = await new DisabledResearchPlanner().plan(input);
    expect(plan.searchQueries[0]).toEqual({ product: "飞书", query: "飞书 协同办公" });
    expect(plan.dimensions).toHaveLength(3);
  });
});

describe("DeepSeekResearchPlanner", () => {
  it("parses and validates json_object output", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validPlan) } }],
    });
    const planner = new DeepSeekResearchPlanner({
      client: { chat: { completions: { create } } },
      model: "deepseek-chat",
    });
    await expect(planner.plan(input)).resolves.toEqual(validPlan);
    expect(create).toHaveBeenCalledOnce();
  });
});
