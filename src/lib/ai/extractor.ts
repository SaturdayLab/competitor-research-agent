import { z } from "zod";

import type { ResearchEvidence, ResearchSource } from "@/lib/domain/research";

const confidenceSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return undefined;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    if (numeric > 1 && numeric <= 100) return numeric / 100;
    if (numeric < 0 || numeric > 1) return undefined;
    return numeric;
  })
  .optional();

export const ExtractedEvidenceSchema = z.object({
  sourceId: z.string().trim().min(1),
  product: z.string().trim().min(1).max(80),
  dimension: z.string().trim().min(1).max(100),
  value: z.unknown(),
  evidenceText: z.string().trim().min(1).max(2_000),
  confidence: confidenceSchema,
});

export const ExtractedEvidenceListSchema = z.object({
  evidence: z.array(ExtractedEvidenceSchema).max(48),
});

export type ExtractedEvidence = z.infer<typeof ExtractedEvidenceSchema>;

export type EvidenceExtractionInput = {
  topic: string;
  competitors: string[];
  focus?: string | null;
  dimensions?: string[];
  sources: ResearchSource[];
};

export interface EvidenceExtractor {
  readonly name: string;
  extract(input: EvidenceExtractionInput): Promise<unknown>;
}

export type NumberedResearchEvidence = {
  id: `E${number}`;
  sourceId: string;
  product: string;
  dimension: string;
  value: unknown;
  evidenceText: string;
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function canonicalProduct(product: string, competitors: string[]): string | null {
  const match = competitors.find((competitor) => normalizeName(competitor) === normalizeName(product));
  return match ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractEvidenceRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const object = asRecord(raw);
  if (!object) return [];
  for (const key of ["evidence", "items", "results", "evidences", "data"]) {
    const candidate = object[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    if (nested && Array.isArray(nested.evidence)) return nested.evidence;
  }
  return [];
}

function resolveSourceId(value: string, sources: ResearchSource[]): string {
  const trimmed = value.trim();
  if (sources.some((source) => source.id === trimmed)) return trimmed;
  const byUrl = sources.find(
    (source) => source.url === trimmed || source.canonicalUrl === trimmed,
  );
  if (byUrl) return byUrl.id;
  const numbered = trimmed.match(/^(?:\[?S)?(\d+)\]?$/i);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    if (sources[index]) return sources[index].id;
  }
  return trimmed;
}

function coerceEvidenceItem(item: unknown, sources: ResearchSource[]): unknown {
  const row = asRecord(item);
  if (!row) return item;
  const evidenceText = String(row.evidenceText ?? row.evidence_text ?? row.quote ?? row.text ?? "")
    .trim()
    .slice(0, 2_000);
  return {
    sourceId: resolveSourceId(String(row.sourceId ?? row.source_id ?? row.source ?? ""), sources),
    product: String(row.product ?? row.productName ?? row.competitor ?? "").trim(),
    dimension: String(row.dimension ?? row.aspect ?? row.field ?? "").trim(),
    value: row.value ?? evidenceText,
    evidenceText,
    confidence: row.confidence,
  };
}

export function normalizeExtractedEvidence(
  raw: unknown,
  input: EvidenceExtractionInput,
): ExtractedEvidence[] {
  const rows = extractEvidenceRows(raw).map((row) => coerceEvidenceItem(row, input.sources));
  const allowedSources = new Set(input.sources.map((source) => source.id));
  const normalized: ExtractedEvidence[] = [];

  for (const row of rows) {
    const parsed = ExtractedEvidenceSchema.safeParse(row);
    if (!parsed.success) continue;
    const product = canonicalProduct(parsed.data.product, input.competitors);
    if (!product || !allowedSources.has(parsed.data.sourceId)) continue;
    normalized.push({
      sourceId: parsed.data.sourceId,
      product,
      dimension: parsed.data.dimension,
      value: parsed.data.value ?? parsed.data.evidenceText,
      evidenceText: parsed.data.evidenceText,
      confidence: parsed.data.confidence,
    });
    if (normalized.length >= 48) break;
  }

  if (normalized.length === 0) throw new Error("证据抽取结果无效");
  return normalized;
}

export function numberedResearchEvidence(
  evidence: Array<Pick<ResearchEvidence, "sourceId" | "product" | "dimension" | "value" | "evidenceText">> = [],
): NumberedResearchEvidence[] {
  return evidence.map((item, index) => ({
    id: `E${index + 1}` as NumberedResearchEvidence["id"],
    sourceId: item.sourceId,
    product: item.product,
    dimension: item.dimension,
    value: item.value,
    evidenceText: item.evidenceText,
  }));
}
