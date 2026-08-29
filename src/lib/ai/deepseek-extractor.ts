import {
  completeJsonObject,
  createDeepSeekClient,
  getDeepSeekMaxTokens,
  getDeepSeekModel,
  type JsonChatClient,
} from "@/lib/ai/deepseek-client";
import type { EvidenceExtractionInput, EvidenceExtractor } from "@/lib/ai/extractor";

const EVIDENCE_JSON_SHAPE = `{
  "evidence": [
    {
      "sourceId": "string",
      "product": "string",
      "dimension": "string",
      "value": "string or small object",
      "evidenceText": "string",
      "confidence": 0.0
    }
  ]
}`;

export class DeepSeekEvidenceExtractor implements EvidenceExtractor {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;

  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }

  async extract(input: EvidenceExtractionInput): Promise<unknown> {
    const pages = input.sources
      .filter((source) => source.extractedText?.trim())
      .map((source) => ({
        sourceId: source.id,
        product: source.product,
        title: source.title,
        url: source.url,
        text: source.extractedText,
      }));

    return completeJsonObject(this.client, {
      model: this.model,
      maxTokens: getDeepSeekMaxTokens(),
      system: [
        "你是数字产品调研的证据抽取器。",
        "只使用用户消息里提供的页面正文，禁止补全正文未出现的价格、日期、版本或其他事实。",
        "每条证据的 sourceId 必须原样复制 pages 里的 sourceId，不要改成标题、序号或 URL。",
        "产品名必须是用户给出的竞品之一。",
        "evidenceText 必须是正文中的短摘录，而不是改写后的评论。",
        "资料不足时可以少输出，不要编造。",
        "使用简洁中文维度名。",
        ...(input.dimensions?.length ? ["优先使用用户提供的计划分析维度；正文没有对应事实时跳过，禁止编造。"] : []),
        "必须输出 JSON 对象，不要 Markdown。",
        `JSON 形状：${EVIDENCE_JSON_SHAPE}`,
      ].join("\n"),
      user: JSON.stringify({
        topic: input.topic,
        competitors: input.competitors,
        focus: input.focus,
        dimensions: input.dimensions,
        pages,
      }),
    });
  }
}
