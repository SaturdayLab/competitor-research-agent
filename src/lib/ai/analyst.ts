import { z } from "zod";

import { numberedResearchEvidence } from "@/lib/ai/extractor";
import type { ResearchEvidence, ResearchSource } from "@/lib/domain/research";

const evidenceIdSchema = z.string().regex(/^E[1-9]\d*$/);

export const AnalysisProductFindingSchema = z.object({
  product: z.string().trim().min(1).max(80),
  finding: z.string().trim().min(1).max(1_000),
  evidenceIds: z.array(evidenceIdSchema).max(24),
});

export const AnalysisGapSchema = z.object({
  product: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(500),
});

export const DimensionAnalysisSchema = z.object({
  dimension: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(1_500),
  productFindings: z.array(AnalysisProductFindingSchema).min(2).max(6),
  leaders: z.array(z.string().trim().min(1).max(80)).max(6),
  evidenceIds: z.array(evidenceIdSchema).max(48),
  gaps: z.array(AnalysisGapSchema).max(6),
});

export const ResearchAnalysisSchema = z.object({
  dimensions: z.array(DimensionAnalysisSchema).min(3).max(8),
  overallSummary: z.string().trim().min(1).max(2_000),
});

export type ResearchAnalysis = z.infer<typeof ResearchAnalysisSchema>;

export type ResearchAnalysisInput = {
  topic: string;
  competitors: string[];
  focus?: string | null;
  dimensions: string[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
};

export interface ResearchAnalyst {
  readonly name: string;
  analyze(input: ResearchAnalysisInput): Promise<unknown>;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function canonicalSet(values: string[], allowed: Map<string, string>, label: string): string[] {
  const seen = new Set<string>();
  return values.map((value) => {
    const normalized = normalizeName(value);
    const canonical = allowed.get(normalized);
    if (!canonical || seen.has(normalized)) throw new Error(`${label}缺失、重复或包含额外项`);
    seen.add(normalized);
    return canonical;
  });
}

function sameSet(actual: Set<string>, expected: Set<string>): boolean {
  return actual.size === expected.size && [...expected].every((value) => actual.has(value));
}

export function validateResearchAnalysis(
  raw: unknown,
  input: ResearchAnalysisInput,
): ResearchAnalysis {
  const parsed = ResearchAnalysisSchema.parse(raw);
  const dimensionMap = new Map(input.dimensions.map((value) => [normalizeName(value), value]));
  const productMap = new Map(input.competitors.map((value) => [normalizeName(value), value]));
  const expectedDimensions = new Set(dimensionMap.keys());
  const actualDimensions = new Set(parsed.dimensions.map((item) => normalizeName(item.dimension)));
  if (!sameSet(actualDimensions, expectedDimensions)) {
    throw new Error("分析维度必须与规划维度同名同集");
  }

  const numberedEvidence = numberedResearchEvidence(input.evidence);
  const evidenceById = new Map(numberedEvidence.map((item) => [item.id, item]));
  const analysisByDimension = new Map(
    parsed.dimensions.map((item) => [normalizeName(item.dimension), item]),
  );

  const dimensions = input.dimensions.map((dimension) => {
    const item = analysisByDimension.get(normalizeName(dimension));
    if (!item) throw new Error(`缺少分析维度：${dimension}`);
    const findingByProduct = new Map(
      item.productFindings.map((finding) => [normalizeName(finding.product), finding]),
    );
    if (findingByProduct.size !== input.competitors.length) {
      throw new Error(`维度“${dimension}”的 productFindings 未完整覆盖竞品`);
    }
    const gapProducts = canonicalSet(item.gaps.map((gap) => gap.product), productMap, "分析 gaps");
    const gapByProduct = new Map(
      item.gaps.map((gap, index) => [normalizeName(gapProducts[index] ?? gap.product), gap]),
    );
    const referenced = new Set<string>();
    const productFindings = input.competitors.map((product) => {
      const finding = findingByProduct.get(normalizeName(product));
      if (!finding) throw new Error(`维度“${dimension}”缺少竞品分析：${product}`);
      for (const evidenceId of finding.evidenceIds) {
        const evidence = evidenceById.get(evidenceId as `E${number}`);
        if (!evidence) throw new Error(`分析引用了不存在的 Evidence：${evidenceId}`);
        if (
          normalizeName(evidence.product) !== normalizeName(product) ||
          normalizeName(evidence.dimension) !== normalizeName(dimension)
        ) {
          throw new Error(`Evidence ${evidenceId} 与维度或竞品不匹配`);
        }
        referenced.add(evidenceId);
      }
      if (finding.evidenceIds.length === 0 && !gapByProduct.has(normalizeName(product))) {
        throw new Error(`无证据的竞品分析必须登记 gap：${dimension} / ${product}`);
      }
      return { ...finding, product };
    });

    const dimensionEvidence = new Set(item.evidenceIds);
    if (!sameSet(dimensionEvidence, referenced)) {
      throw new Error(`维度“${dimension}”的 evidenceIds 必须等于 productFindings 引用并集`);
    }
    for (const evidenceId of dimensionEvidence) {
      if (!evidenceById.has(evidenceId as `E${number}`)) {
        throw new Error(`分析引用了不存在的 Evidence：${evidenceId}`);
      }
    }

    return {
      ...item,
      dimension,
      productFindings,
      leaders: canonicalSet(item.leaders, productMap, "分析 leaders"),
      evidenceIds: [...referenced],
      gaps: item.gaps.map((gap, index) => ({ ...gap, product: gapProducts[index] ?? gap.product })),
    };
  });

  return { dimensions, overallSummary: parsed.overallSummary };
}
