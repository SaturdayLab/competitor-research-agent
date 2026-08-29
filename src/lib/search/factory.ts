import { BraveSearchProvider } from "@/lib/search/brave-search-provider";
import { DisabledSearchProvider, type SearchProvider } from "@/lib/search/provider";

type SearchEnvironment = Readonly<Record<string, string | undefined>>;

const DEFAULT_SEARCH_RESULT_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 8_000;

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function getSearchResultCount(environment: SearchEnvironment = process.env): number {
  return parseBoundedInt(environment.SEARCH_RESULT_COUNT, DEFAULT_SEARCH_RESULT_COUNT, 1, 20);
}

export function createSearchProvider(environment: SearchEnvironment = process.env): SearchProvider {
  const provider = environment.SEARCH_PROVIDER?.trim().toLocaleLowerCase() || "disabled";
  if (provider === "disabled") return new DisabledSearchProvider();
  if (provider === "brave") {
    const apiKey = environment.BRAVE_SEARCH_API_KEY?.trim();
    if (!apiKey) throw new Error("SEARCH_PROVIDER=brave 时必须配置 BRAVE_SEARCH_API_KEY");
    return new BraveSearchProvider(apiKey, {
      timeoutMs: parseBoundedInt(environment.BRAVE_SEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    });
  }
  throw new Error(`不支持的 SEARCH_PROVIDER：${provider}`);
}
