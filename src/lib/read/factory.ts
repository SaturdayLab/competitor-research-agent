import { HttpPageReader } from "@/lib/read/http-page-reader";
import type { PageReader } from "@/lib/read/page-reader";

type ReadEnvironment = Readonly<Record<string, string | undefined>>;

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_REDIRECTS = 3;

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

export function getPageReadTimeoutMs(environment: ReadEnvironment = process.env): number {
  return parseBoundedInt(environment.PAGE_READ_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
}

export function getPageReadMaxBytes(environment: ReadEnvironment = process.env): number {
  return parseBoundedInt(environment.PAGE_READ_MAX_BYTES, DEFAULT_MAX_BYTES, 4_096, 5_242_880);
}

export function getPageReadMaxRedirects(environment: ReadEnvironment = process.env): number {
  return parseBoundedInt(environment.PAGE_READ_MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS, 0, 5);
}

export function createPageReader(environment: ReadEnvironment = process.env): PageReader {
  return new HttpPageReader({
    timeoutMs: getPageReadTimeoutMs(environment),
    maxBytes: getPageReadMaxBytes(environment),
    maxRedirects: getPageReadMaxRedirects(environment),
  });
}
