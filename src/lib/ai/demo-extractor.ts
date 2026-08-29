import type { EvidenceExtractionInput, EvidenceExtractor, ExtractedEvidence } from "@/lib/ai/extractor";

function firstDimension(focus?: string | null): string {
  if (!focus) return "产品概述";
  const dimension = focus
    .split(/[，,、;；]/)
    .map((item) => item.trim())
    .find(Boolean);
  return dimension || "产品概述";
}

function excerpt(text: string, max = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : compact.slice(0, max).trimEnd();
}

export class DemoEvidenceExtractor implements EvidenceExtractor {
  readonly name = "demo";

  async extract(input: EvidenceExtractionInput): Promise<ExtractedEvidence[]> {
    const dimension = input.dimensions?.[0] ?? firstDimension(input.focus);
    const allowed = new Set(input.competitors.map((competitor) => competitor.toLocaleLowerCase()));
    const evidence: ExtractedEvidence[] = [];

    for (const source of input.sources) {
      if (!source.extractedText?.trim()) continue;
      if (!allowed.has(source.product.toLocaleLowerCase())) continue;
      const evidenceText = excerpt(source.extractedText);
      evidence.push({
        sourceId: source.id,
        product: source.product,
        dimension,
        value: evidenceText,
        evidenceText,
        confidence: 0.5,
      });
    }

    return evidence;
  }
}
