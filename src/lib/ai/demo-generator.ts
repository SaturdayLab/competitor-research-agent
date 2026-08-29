import { numberedResearchEvidence } from "@/lib/ai/extractor";
import {
  numberedResearchSources,
  type ResearchGenerationInput,
  type ResearchGenerator,
} from "@/lib/ai/generator";
import type { ResearchDraft } from "@/lib/domain/research";

function suggestedDimensions(input: ResearchGenerationInput): string[] {
  if (input.dimensions?.length) return input.dimensions;
  if (input.focus) {
    const dimensions = input.focus
      .split(/[，,、;；]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (dimensions.length > 0) return dimensions;
  }
  return ["产品定位", "核心能力", "适用人群"];
}

export class DemoResearchGenerator implements ResearchGenerator {
  readonly name = "demo";

  async generate(input: ResearchGenerationInput): Promise<ResearchDraft> {
    const dimensions = suggestedDimensions(input);
    const numbered = numberedResearchSources(input.sources);
    const numberedEvidence = numberedResearchEvidence(input.evidence);
    const groundedByEvidence = numberedEvidence.length > 0;
    const grounded = numbered.length > 0;
    const sourceLabels = numbered.map((source) => `[${source.id}]`).join("、");
    const evidenceLabels = numberedEvidence.map((item) => `[${item.id}]`).join("、");
    return {
      title: groundedByEvidence
        ? `${input.topic}｜证据约束报告`
        : grounded
          ? `${input.topic}｜来源摘要报告`
          : `${input.topic}｜流程验证报告`,
      executiveSummary: groundedByEvidence
        ? `这份报告由 Demo Provider 根据 ${numberedEvidence.length} 条页面证据生成，仅用于验证 Evidence Grounding。摘录外的产品事实均视为未确认，不能作为正式竞品结论。`
        : grounded
          ? `这份报告由 Demo Provider 根据 ${numbered.length} 条已保存搜索摘要生成，仅用于验证 Source Grounding。摘要外的产品事实均视为未确认，不能作为正式竞品结论。`
          : "这份报告由确定性的 Demo Provider 生成，用于验证任务创建、后台状态流转、结构化输出、持久化与报告展示。它不包含实时网页检索结果，不应作为正式竞品结论使用。",
      products: input.competitors.map((competitor, index) => ({
        name: competitor,
        positioning: `${competitor} 是本次“${input.topic}”任务中的第 ${index + 1} 个候选产品。`,
        strengths: ["已进入统一的多竞品结构化对比数据模型。"],
        limitations: groundedByEvidence
          ? ["当前仅使用页面摘录，未覆盖全部来源页面，产品事实仍受摘录范围限制。"]
          : grounded
            ? ["当前仅使用搜索摘要，未读取来源页面，产品事实仍未被正文验证。"]
            : ["未启用联网搜索与页面证据，产品事实未被外部来源验证。"],
        bestFor: "用于验证调研工作流、页面状态和报告结构的开发或演示场景。",
      })),
      dimensions: input.analysis
        ? input.analysis.dimensions.map((dimension) => ({
            name: dimension.dimension,
            summary: dimension.summary,
            leaders: dimension.leaders,
          }))
        : dimensions.map((dimension) => ({
            name: dimension,
            summary: groundedByEvidence
              ? `“${dimension}”仅能依据已编号证据 ${evidenceLabels} 作流程验证，不能把摘录未出现的事实写成已确认结论。`
              : grounded
                ? `“${dimension}”仅能依据已编号摘要 ${sourceLabels} 作流程验证，不能把摘要未出现的事实写成已确认结论。`
                : `当前仅验证“${dimension}”维度能够被保存和展示；未启用联网搜索，不能生成有公开资料支持的横向结论。`,
            leaders: [],
          })),
      conclusion: groundedByEvidence
        ? "页面证据已在生成前保存。报告结论不得超出已编号摘录。"
        : grounded
          ? "来源已在生成前保存。下一阶段应读取页面正文并抽取原子 Evidence，再对产品差异作可引用判断。"
          : "当前报告仅用于验证端到端流程。启用联网搜索、页面读取和证据抽取后，才能对产品差异作有来源的判断。",
      limitations: groundedByEvidence
        ? [
            `报告仅依据 ${numberedEvidence.length} 条页面证据（${evidenceLabels}），未使用摘录之外的事实。`,
            "摘录未出现的价格、版本号、日期和其他当前事实均视为未确认。",
            "Demo 输出仅用于工程验收，不能用于真实产品决策。",
          ]
        : grounded
          ? [
              `报告仅依据 ${numbered.length} 条搜索摘要（${sourceLabels}），未读取来源页面正文。`,
              "摘要未出现的价格、版本号、日期和其他当前事实均视为未确认。",
              "Demo 输出仅用于工程验收，不能用于真实产品决策。",
            ]
          : [
              "未调用公开资料搜索或页面读取工具。",
              "没有 Source / Evidence，因此不包含可引用的产品事实。",
              "Demo 输出仅用于工程验收，不能用于真实产品决策。",
            ],
    };
  }
}
