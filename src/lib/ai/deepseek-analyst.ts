import {
  completeJsonObject,
  createDeepSeekClient,
  getDeepSeekMaxTokens,
  getDeepSeekModel,
  type JsonChatClient,
} from "@/lib/ai/deepseek-client";
import {
  validateResearchAnalysis,
  type ResearchAnalysisInput,
  type ResearchAnalyst,
} from "@/lib/ai/analyst";
import { numberedResearchEvidence } from "@/lib/ai/extractor";
import { toErrorMessage } from "@/lib/errors";

const ANALYSIS_JSON_SHAPE = `{
  "dimensions": [{
    "dimension": "string",
    "summary": "string",
    "productFindings": [{ "product": "string", "finding": "string", "evidenceIds": ["E1"] }],
    "leaders": ["string"],
    "evidenceIds": ["E1"],
    "gaps": [{ "product": "string", "reason": "string" }]
  }],
  "overallSummary": "string"
}`;

const normalizeName = (value: string) => value.trim().toLocaleLowerCase();

function repairMissingProductFindings(raw: unknown, input: ResearchAnalysisInput): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const repaired = structuredClone(raw) as Record<string, unknown>;
  if (!Array.isArray(repaired.dimensions)) return raw;
  for (const value of repaired.dimensions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const dimension = value as Record<string, unknown>;
    if (typeof dimension.dimension !== "string" || !input.dimensions.some((item) => normalizeName(item) === normalizeName(dimension.dimension as string))) continue;
    if (!Array.isArray(dimension.productFindings) || !Array.isArray(dimension.gaps)) continue;
    const existing = new Set(dimension.productFindings.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).product === "string" ? [normalizeName((item as Record<string, unknown>).product as string)] : []));
    const gapProducts = new Set(dimension.gaps.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).product === "string" ? [normalizeName((item as Record<string, unknown>).product as string)] : []));
    for (const product of input.competitors) {
      if (existing.has(normalizeName(product))) continue;
      dimension.productFindings.push({ product, finding: "资料不足，未找到可引用的 Evidence。", evidenceIds: [] });
      if (!gapProducts.has(normalizeName(product))) dimension.gaps.push({ product, reason: "资料不足，未找到可引用的 Evidence。" });
    }
    const referenced = new Set<string>();
    for (const finding of dimension.productFindings) {
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) continue;
      const ids = (finding as Record<string, unknown>).evidenceIds;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) if (typeof id === "string") referenced.add(id);
    }
    dimension.evidenceIds = [...referenced];
  }
  return repaired;
}

export class DeepSeekResearchAnalyst implements ResearchAnalyst {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;

  constructor(options: { client?: JsonChatClient; model?: string } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
  }

  async analyze(input: ResearchAnalysisInput): Promise<unknown> {
    const numberedEvidence = numberedResearchEvidence(input.evidence);
    const normalize = (value: string) => value.trim().toLocaleLowerCase();
    const allowedEvidenceIds = input.dimensions.flatMap((dimension) => input.competitors.map((product) => ({
      dimension,
      product,
      evidenceIds: numberedEvidence
        .filter((item) => normalize(item.dimension) === normalize(dimension) && normalize(item.product) === normalize(product))
        .map((item) => item.id),
    })));
    const baseUserInput = {
      topic: input.topic,
      competitors: input.competitors,
      focus: input.focus,
      dimensions: input.dimensions,
      evidence: numberedEvidence,
      allowedEvidenceIds,
    };
    const request = (user: unknown) => completeJsonObject(this.client, {
      model: this.model,
      maxTokens: getDeepSeekMaxTokens(),
      system: [
        "你是数字产品竞品研究分析员。",
        "只能依据用户提供的编号 Evidence 做横向分析，禁止使用模型自身知识。",
        "Source 搜索摘要不能作为事实；本次输入不会提供摘要。",
        "分析维度必须使用 Planner 原名并完整覆盖，不得增加、缺少或改名。",
        "每个维度必须有 summary，并在 productFindings 中覆盖全部竞品。",
        "Evidence 不足时仍保留竞品 finding，明确说明资料不足，并在 gaps 登记。",
        "E 编号必须从输入原样复制；维度 evidenceIds 必须等于各 finding 引用的去重并集。",
        "每个 productFinding 只能使用 allowedEvidenceIds 中同维度、同竞品列出的 E 编号；列表为空时必须使用空数组并登记 gap。",
        "只输出 JSON，不要 Markdown。",
        `JSON 形状：${ANALYSIS_JSON_SHAPE}`,
      ].join("\n"),
      user: JSON.stringify(user),
    });
    const raw = await request(baseUserInput);
    try {
      return validateResearchAnalysis(raw, input);
    } catch (error) {
      const corrected = await request({
        ...baseUserInput,
        correction: {
          validationError: toErrorMessage(error),
          previousOutput: raw,
          requiredCoverage: input.dimensions.map((dimension) => ({
            dimension,
            requiredProducts: input.competitors,
          })),
          instruction: "修正校验错误后重新输出完整 JSON。逐个维度检查 productFindings 必须按 requiredProducts 完整覆盖；无证据也必须保留 finding 并登记 gap。不得放宽、删除或改写 Evidence 引用规则。",
        },
      });
      return validateResearchAnalysis(repairMissingProductFindings(corrected, input), input);
    }
  }
}
