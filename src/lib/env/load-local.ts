import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadLocalEnv(filePath = resolve(process.cwd(), ".env.local")): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const loaded: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!name || process.env[name] !== undefined) continue;
    process.env[name] = stripQuotes(trimmed.slice(eq + 1).trim());
    loaded.push(name);
  }
  return loaded;
}
