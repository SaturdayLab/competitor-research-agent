import { completeJsonObject, createDeepSeekClient, getDeepSeekModel, type JsonChatClient } from "@/lib/ai/deepseek-client";
import { numberedResearchEvidence } from "@/lib/ai/extractor";
import {
  numberedResearchSources,
  type ResearchGenerationInput,
  type ResearchGenerator,
} from "@/lib/ai/generator";

const DRAFT_JSON_SHAPE = `{
  "title": "string",
  "executiveSummary": "string",
  "products": [{ "name": "string", "positioning": "string", "strengths": ["string"], "limitations": ["string"], "bestFor": "string" }],
  "dimensions": [{ "name": "string", "summary": "string", "leaders": ["string"] }],
  "conclusion": "string",
  "limitations": ["string"]
}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedRequiredList(value: unknown, fallback: string): unknown {
  if (!Array.isArray(value)) return value;
  const items = value.slice(0, 8);
  return items.length > 0 ? items : [fallback];
}

export function normalizeDeepSeekDraft(raw: unknown): unknown {
  const draft = asRecord(raw);
  if (!draft) return raw;

  const products = Array.isArray(draft.products)
    ? draft.products.map((value) => {
        const product = asRecord(value);
        if (!product) return value;
        return {
          ...product,
          strengths: boundedRequiredList(
            product.strengths,
            "现有证据不足，暂不作优势判断。",
          ),
          limitations: boundedRequiredList(
            product.limitations,
            "现有证据不足，建议人工确认该产品的局限。",
          ),
        };
      })
    : draft.products;
  const dimensions = Array.isArray(draft.dimensions)
    ? draft.dimensions.slice(0, 12).map((value) => {
        const dimension = asRecord(value);
        if (!dimension) return value;
        return {
          ...dimension,
          leaders: Array.isArray(dimension.leaders) ? dimension.leaders.slice(0, 6) : dimension.leaders,
        };
      })
    : draft.dimensions;

  return {
    ...draft,
    products,
    dimensions,
    limitations: boundedRequiredList(
      draft.limitations,
      "现有证据仍有不足，报告结论建议人工复核。",
    ),
  };
}

export class DeepSeekResearchGenerator implements ResearchGenerator {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;

  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }

  async generate(input: ResearchGenerationInput): Promise<unknown> {
    const sources = numberedResearchSources(input.sources);
    const evidence = numberedResearchEvidence(input.evidence);
    const groundedByEvidence = evidence.length > 0;
    const grounded = sources.length > 0;

    const instructions = groundedByEvidence
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
          ];

    const raw = await completeJsonObject(this.client, {
      model: this.model,
      system: [
        ...instructions,
        ...(input.dimensions?.length
          ? ["报告 dimensions 必须使用计划中的名称，不要另起一套平行维度。"]
          : []),
        ...(input.analysis
          ? [
              "必须以用户提供的 analysis 为横向比较骨架，覆盖其中的 productFindings 与 gaps。",
              "可以压缩措辞，但不能改变 analysis 中 Evidence 支持的事实边界，也不能重新从 Source 摘要推断事实。",
            ]
          : []),
        "必须输出 JSON 对象，不要 Markdown。",
        `JSON 形状：${DRAFT_JSON_SHAPE}`,
        "products 至少包含用户给出的每一个竞品；每个产品的 strengths 与 limitations、以及顶层 limitations 都不能为空且各自最多 8 条。",
      ].join("\n"),
      user: JSON.stringify({
        topic: input.topic,
        competitors: input.competitors,
        focus: input.focus,
        dimensions: input.dimensions,
        analysis: input.analysis,
        sources,
        evidence,
        revisionNotes: input.revisionNotes ?? [],
      }),
    });
    return normalizeDeepSeekDraft(raw);
  }
}
