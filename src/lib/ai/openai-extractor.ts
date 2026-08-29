import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { ExtractedEvidenceListSchema, type EvidenceExtractionInput, type EvidenceExtractor } from "@/lib/ai/extractor";
import { ConfigurationError } from "@/lib/errors";

export class OpenAIEvidenceExtractor implements EvidenceExtractor {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_MODEL?.trim();
    if (!apiKey) throw new ConfigurationError("RESEARCH_PROVIDER=openai 时必须设置 OPENAI_API_KEY。");
    if (!model) throw new ConfigurationError("RESEARCH_PROVIDER=openai 时必须设置 OPENAI_MODEL。");

    this.model = model;
    this.client = new OpenAI({
      apiKey,
      maxRetries: 2,
      timeout: 60_000,
    });
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

    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      instructions: [
        "你是数字产品调研的证据抽取器。",
        "只使用用户消息里提供的页面正文，禁止补全正文未出现的价格、日期、版本或其他事实。",
        "每条证据必须引用提供的 sourceId，产品名必须是用户给出的竞品之一。",
        "evidenceText 必须是正文中的短摘录，而不是改写后的评论。",
        "资料不足时可以少输出，不要编造。",
        "使用简洁中文维度名。",
      ].join("\n"),
      input: JSON.stringify({
        topic: input.topic,
        competitors: input.competitors,
        focus: input.focus,
        dimensions: input.dimensions,
        pages,
      }),
      text: {
        format: zodTextFormat(ExtractedEvidenceListSchema, "research_evidence_list"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("模型未返回可解析的结构化证据");
    }
    return response.output_parsed;
  }
}
