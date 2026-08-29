import { completeJsonObject, createDeepSeekClient, getDeepSeekMaxTokens, getDeepSeekModel, type JsonChatClient } from "@/lib/ai/deepseek-client";
import type { GapQueryInput, GapQueryPlanner } from "@/lib/ai/gap-investigator";

export class DeepSeekGapQueryPlanner implements GapQueryPlanner {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;
  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }
  async plan(input: GapQueryInput): Promise<unknown> {
    return completeJsonObject(this.client, {
      model: this.model,
      maxTokens: getDeepSeekMaxTokens(),
      system: "你为明确的竞品证据缺口生成搜索词。每个 query 必须包含给定竞品原名和维度原名。每格恰好一条，只输出 JSON：{\"queries\":[{\"product\":\"\",\"dimension\":\"\",\"query\":\"\"}]}",
      user: JSON.stringify(input),
    });
  }
}
