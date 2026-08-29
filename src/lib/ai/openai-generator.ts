import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { ResearchDraftSchema } from "@/lib/domain/research";
import { ConfigurationError } from "@/lib/errors";
import { numberedResearchEvidence } from "@/lib/ai/extractor";
import {
  numberedResearchSources,
  type ResearchGenerationInput,
  type ResearchGenerator,
} from "@/lib/ai/generator";

export class OpenAIResearchGenerator implements ResearchGenerator {
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

  async generate(input: ResearchGenerationInput): Promise<unknown> {
    const sources = numberedResearchSources(input.sources);
    const evidence = numberedResearchEvidence(input.evidence);
    const groundedByEvidence = evidence.length > 0;
    const grounded = sources.length > 0;
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      instructions: [
        ...(groundedByEvidence
        ? [
            "你是数字产品竞品研究助理。",
            "当前输入包含页面证据：只能使用用户消息中编号证据摘录里的信息。",
            "证据编号为稳定的 [E1]、[E2] 形式；引用时使用这些编号。",
            "禁止把摘录中未出现的价格、日期、版本号或其他当前事实写成已确认结论。",
            "资料索引中的来源只能用于指向出处，不能当作额外事实。",
            "资料不足时必须在 limitations 中明确说明缺口，而不是补全未提供的事实。",
            "必须覆盖用户给出的每一个竞品，产品名称保持原样。",
            "使用简洁、专业的中文。",
          ]
        : grounded
          ? [
              "你是数字产品竞品研究助理。",
              "当前输入仅包含搜索摘要：只能使用用户消息中编号来源摘要里的信息。",
              "来源编号为稳定的 [S1]、[S2] 形式；引用时使用这些编号。",
              "禁止把摘要中未出现的价格、日期、版本号或其他当前事实写成已确认结论。",
              "资料不足时必须在 limitations 中明确说明缺口，而不是补全未提供的事实。",
              "必须覆盖用户给出的每一个竞品，产品名称保持原样。",
              "使用简洁、专业的中文。",
            ]
          : [
              "你是数字产品竞品研究助理。",
              "当前没有网页搜索或来源证据。只生成用于验证产品流程的初步分析。",
              "避免精确价格、日期、版本号或无法验证的当前事实。",
              "必须覆盖用户给出的每一个竞品，产品名称保持原样。",
              "局限说明必须明确写出未接入 Web Search、结论尚无 Source/Evidence。",
              "使用简洁、专业的中文。",
            ]),
        ...(input.analysis
          ? [
              "必须以用户提供的 analysis 为横向比较骨架，覆盖其中的 productFindings 与 gaps。",
              "不能改变 analysis 中 Evidence 支持的事实边界，也不能把 Source 摘要当作额外事实。",
            ]
          : []),
      ].join("\n"),
      input: JSON.stringify({
        topic: input.topic,
        competitors: input.competitors,
        focus: input.focus,
        dimensions: input.dimensions,
        analysis: input.analysis,
        sources,
        evidence,
      }),
      text: {
        format: zodTextFormat(ResearchDraftSchema, "competitive_research_draft"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("模型未返回可解析的结构化竞品报告");
    }
    return response.output_parsed;
  }
}
