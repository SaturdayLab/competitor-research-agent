type Product = {
  name: string;
  region: "domestic" | "overseas";
  reason: string;
  sourceIds: string[];
};

function normalizedName(name: string) {
  return name.trim().toLocaleLowerCase();
}

const broadCategoryHints: Record<string, string> = {
  "ai": "这个范围较宽，改成“AI 编程助手”“AI 搜索”或“AI 写作工具”，结果会更可比。",
  "人工智能": "这个范围较宽，建议补充具体场景，例如“AI 编程助手”或“AI 搜索”。",
  "办公": "这个范围较宽，改成“协同办公”“办公套件”或“视频会议”，结果会更可比。",
  "电商": "这个范围较宽，改成“综合电商”“跨境电商”或“生鲜电商”，结果会更可比。",
  "软件": "这个范围太宽，建议补充具体使用场景后再发现产品。",
  "saas": "这个范围较宽，建议补充具体场景，例如“CRM SaaS”或“项目管理 SaaS”。",
};

export function getCategorySpecificityHint(category: string): string | null {
  return broadCategoryHints[category.trim().toLocaleLowerCase()] ?? null;
}

export function getRefreshExclusions(previous: string[], currentProducts: Product[]): string[] {
  return [...new Set([...previous, ...currentProducts.map((product) => product.name)])];
}

export function getSynchronizedAutomaticTopic(
  currentTopic: string,
  previousAutomaticTopic: string | null,
  category: string,
): string {
  if (currentTopic.trim() && currentTopic !== previousAutomaticTopic) return currentTopic;
  return category.trim() ? `${category.trim()}竞品分析` : "";
}

export function mergeRefreshedProducts<T extends Product>(
  current: T[],
  incoming: T[],
  lockedNames: ReadonlySet<string>,
  total: number,
): T[] {
  const normalizedLocks = new Set([...lockedNames].map(normalizedName));
  const locked = new Set(
    current.filter((product) => normalizedLocks.has(normalizedName(product.name))).map((product) => normalizedName(product.name)),
  );
  const seen = new Set(locked);
  const replacements = incoming.filter((product) => {
    const name = normalizedName(product.name);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  let replacementIndex = 0;
  const merged = current.slice(0, total).flatMap((product) => {
    if (locked.has(normalizedName(product.name))) return [product];
    const replacement = replacements[replacementIndex++];
    return replacement ? [replacement] : [];
  });
  while (merged.length < total && replacementIndex < replacements.length) {
    merged.push(replacements[replacementIndex++]);
  }
  return merged;
}
