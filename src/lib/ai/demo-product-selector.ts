import type { ProductSelector } from "@/lib/ai/product-discovery";

function candidateName(title: string): string {
  return title.split(/[｜|:：\-–—]/)[0]?.trim().slice(0, 80) || title.trim().slice(0, 80);
}

export class DemoProductSelector implements ProductSelector {
  readonly name = "demo";

  async select(input: Parameters<ProductSelector["select"]>[0]): Promise<unknown> {
    const products = [];
    const seen = new Set<string>();
    for (const source of input.sources) {
      const name = candidateName(source.title);
      const normalized = name.toLocaleLowerCase();
      if (!name || seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({
        name,
        region: source.regionHint,
        reason: `搜索结果“${source.title}”与“${input.category}”相关。`,
        sourceIds: [source.id],
      });
      if (products.length >= input.count) break;
    }
    return { products };
  }
}

