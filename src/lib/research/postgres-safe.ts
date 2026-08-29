export function stripPostgresNulls(value: string): string {
  return value.replaceAll("\u0000", "");
}

export function makePostgresJsonSafe(value: unknown): unknown {
  if (typeof value === "string") return stripPostgresNulls(value);
  if (Array.isArray(value)) return value.map(makePostgresJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [stripPostgresNulls(key), makePostgresJsonSafe(item)]),
    );
  }
  return value;
}
