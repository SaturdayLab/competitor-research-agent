import type { ResearchDraft, ResearchEvidence, ResearchSource } from "@/lib/domain/research";

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|-])/g, "\\$1")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${escapeMarkdown(item)}`).join("\n");
}

function escapeHref(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n]+/g, "")
    .trim();
}

export function renderResearchMarkdown(
  draft: ResearchDraft,
  sources: ResearchSource[] = [],
  evidence: ResearchEvidence[] = [],
): string {
  const productSections = draft.products
    .map(
      (product) => `### ${escapeMarkdown(product.name)}

**产品定位：** ${escapeMarkdown(product.positioning)}

**优势**

${bulletList(product.strengths)}

**不足**

${bulletList(product.limitations)}

**适用人群：** ${escapeMarkdown(product.bestFor)}`,
    )
    .join("\n\n");

  const dimensionSections = draft.dimensions
    .map(
      (dimension) => `### ${escapeMarkdown(dimension.name)}

${escapeMarkdown(dimension.summary)}

**表现突出：** ${dimension.leaders.map(escapeMarkdown).join("、") || "暂无"}`,
    )
    .join("\n\n");

  const sourcesSection =
    sources.length === 0
      ? ""
      : `

## 资料索引

${sources
  .map((source, index) => {
    const label = `[S${index + 1}]`;
    return `${label} ${escapeMarkdown(source.title)} — ${escapeHref(source.url)}（${escapeMarkdown(source.product)}）`;
  })
  .join("\n")}
`;

  const evidenceSection =
    evidence.length === 0
      ? ""
      : `

## 证据摘录

${evidence
  .map((item, index) => {
    const label = `[E${index + 1}]`;
    return `${label} ${escapeMarkdown(item.product)} / ${escapeMarkdown(item.dimension)}：${escapeMarkdown(item.evidenceText)}`;
  })
  .join("\n")}
`;

  return `# ${escapeMarkdown(draft.title)}

## Executive Summary

${escapeMarkdown(draft.executiveSummary)}

## 竞品概览

${productSections}

## 分维度分析

${dimensionSections}

## 最终结论

${escapeMarkdown(draft.conclusion)}

## 局限与来源说明

${bulletList(draft.limitations)}
${sourcesSection}${evidenceSection}`;
}
