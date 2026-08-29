import { z } from "zod";

import type { ResearchEvidence } from "@/lib/domain/research";

export type EvidenceGap = { product: string; dimension: string };
export type GapQueryInput = { topic: string; focus?: string | null; gaps: EvidenceGap[] };
export type GapSearchQuery = EvidenceGap & { query: string };

export interface GapQueryPlanner {
  readonly name: string;
  plan(input: GapQueryInput): Promise<unknown>;
}

export class DisabledGapQueryPlanner implements GapQueryPlanner {
  readonly name = "disabled";
  async plan(): Promise<unknown> { return { queries: [] }; }
}

export const GapSearchQueriesSchema = z.object({
  queries: z.array(z.object({
    product: z.string().trim().min(1).max(80),
    dimension: z.string().trim().min(1).max(100),
    query: z.string().trim().min(1).max(240),
  })).max(3),
});

const norm = (value: string) => value.trim().toLocaleLowerCase();
const compact = (value: string) => norm(value).replaceAll(/\s+/g, "");
const containsDimension = (query: string, dimension: string) => {
  const haystack = compact(query);
  if (haystack.includes(compact(dimension))) return true;
  const parts = dimension.split(/[与和及、/]/).map(compact).filter(Boolean);
  return parts.length > 1 && parts.every((part) => haystack.includes(part));
};
const cellKey = (product: string, dimension: string) => `${norm(product)}\0${norm(dimension)}`;

export function findEvidenceGaps(competitors: string[], dimensions: string[], evidence: ResearchEvidence[]): EvidenceGap[] {
  const covered = new Set(evidence.map((item) => cellKey(item.product, item.dimension)));
  return dimensions.flatMap((dimension) => competitors.flatMap((product) =>
    covered.has(cellKey(product, dimension)) ? [] : [{ product, dimension }],
  ));
}

export function selectEvidenceGaps(gaps: EvidenceGap[], limit = 3): EvidenceGap[] {
  const selected: EvidenceGap[] = [];
  const products = new Set<string>();
  for (const gap of gaps) {
    if (selected.length >= limit) break;
    if (products.has(norm(gap.product))) continue;
    products.add(norm(gap.product));
    selected.push(gap);
  }
  return selected;
}

export function normalizeGapQueries(raw: unknown, selected: EvidenceGap[]): { valid: GapSearchQuery[]; invalid: EvidenceGap[] } {
  const rows = GapSearchQueriesSchema.safeParse(raw);
  if (!rows.success) return { valid: [], invalid: selected };
  const byCell = new Map(rows.data.queries.map((item) => [cellKey(item.product, item.dimension), item]));
  const valid: GapSearchQuery[] = [];
  const invalid: EvidenceGap[] = [];
  for (const gap of selected) {
    const row = byCell.get(cellKey(gap.product, gap.dimension));
    const query = row?.query ?? "";
    if (!compact(query).includes(compact(gap.product)) || !containsDimension(query, gap.dimension)) {
      invalid.push(gap);
    } else valid.push({ ...gap, query });
  }
  return { valid, invalid };
}
