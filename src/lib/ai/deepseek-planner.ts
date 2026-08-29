import {
  completeJsonObject,
  createDeepSeekClient,
  getDeepSeekMaxTokens,
  getDeepSeekModel,
  type JsonChatClient,
} from "@/lib/ai/deepseek-client";
import {
  assertResearchPlanCoverage,
  ResearchPlanSchema,
  type ResearchPlanInput,
  type ResearchPlanner,
} from "@/lib/ai/planner";

const PLAN_JSON_SHAPE = `{
  "dimensions": ["string"],
  "searchQueries": [{ "product": "string", "query": "string" }],
  "rationale": "string"
}`;

export class DeepSeekResearchPlanner implements ResearchPlanner {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;

  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }

  async plan(input: ResearchPlanInput): Promise<unknown> {
    const raw = await completeJsonObject(this.client, {
      model: this.model,
      maxTokens: getDeepSeekMaxTokens(),
      system: [
        "你是数字产品竞品研究规划员。",
        "根据本次主题、竞品和关注点动态生成 3 至 8 个共享分析维度，禁止套用固定品类模板。",
        "为每个竞品生成恰好一条高召回搜索词，搜索词必须包含该竞品原名。",
        "只输出 JSON，不要 Markdown。",
        `JSON 形状：${PLAN_JSON_SHAPE}`,
      ].join("\n"),
      user: JSON.stringify(input),
    });
    const plan = ResearchPlanSchema.parse(raw);
    assertResearchPlanCoverage(plan, input);
    return plan;
  }
}
