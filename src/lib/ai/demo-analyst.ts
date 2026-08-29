import {
  validateResearchAnalysis,
  type ResearchAnalysis,
  type ResearchAnalysisInput,
  type ResearchAnalyst,
} from "@/lib/ai/analyst";
import { numberedResearchEvidence } from "@/lib/ai/extractor";

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function excerpt(value: string, max = 320): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : compact.slice(0, max).trimEnd();
}

export class DemoResearchAnalyst implements ResearchAnalyst {
  readonly name = "demo";

  async analyze(input: ResearchAnalysisInput): Promise<ResearchAnalysis> {
    const evidence = numberedResearchEvidence(input.evidence);
    const raw = {
      dimensions: input.dimensions.map((dimension) => {
        const productFindings = input.competitors.map((product) => {
          const matching = evidence.filter(
            (item) =>
              normalizeName(item.product) === normalizeName(product) &&
              normalizeName(item.dimension) === normalizeName(dimension),
          );
          return {
            product,
            finding:
              matching.length > 0
                ? matching.map((item) => excerpt(item.evidenceText)).join("；").slice(0, 1_000)
                : `现有 Evidence 不足以判断 ${product} 在“${dimension}”上的表现。`,
            evidenceIds: matching.slice(0, 24).map((item) => item.id),
          };
        });
        const evidenceIds = [...new Set(productFindings.flatMap((item) => item.evidenceIds))];
        const gaps = productFindings
          .filter((item) => item.evidenceIds.length === 0)
          .map((item) => ({ product: item.product, reason: `缺少“${dimension}”维度的页面证据。` }));
        return {
          dimension,
          summary: `“${dimension}”维度有 ${input.competitors.length - gaps.length} 个竞品具备 Evidence，${gaps.length} 个竞品存在资料缺口。`,
          productFindings,
          leaders: [],
          evidenceIds,
          gaps,
        };
      }),
      overallSummary: `本次分析严格依据 ${evidence.length} 条编号 Evidence，并按 ${input.dimensions.length} 个规划维度整理；资料不足处已标记为 gaps。`,
    };
    return validateResearchAnalysis(raw, input);
  }
}
