import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function hostKind(url) {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith(".supabase.co") || host.endsWith(".supabase.net")) return "supabase-cloud";
    if (host === "localhost" || host === "127.0.0.1") return "local";
    return "other";
  } catch {
    return "invalid";
  }
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.log(JSON.stringify({ ok: false, error: "缺少 URL 或 SERVICE_ROLE_KEY" }));
  process.exit(1);
}

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tables = [
  "research_tasks",
  "workflow_runs",
  "research_steps",
  "research_sources",
  "research_reports",
];
const tableResults = {};
for (const table of tables) {
  const { error, count } = await client.from(table).select("*", { count: "exact", head: true });
  tableResults[table] = error
    ? { ok: false, message: error.message, code: error.code }
    : { ok: true, count };
}

const { error: sourceColumnError } = await client
  .from("research_sources")
  .select("snippet,run_id")
  .limit(1);

const { error: fetchColumnError } = await client
  .from("research_sources")
  .select("extracted_text,fetch_status,fetch_error")
  .limit(1);

const { error: claimError } = await client.rpc("claim_next_workflow_run", {
  worker_identity: "connection-check",
});

const { error: completeError } = await client.rpc("complete_research_step", {
  step_public_id: "00000000-0000-0000-0000-000000000000",
});

const okTables = Object.values(tableResults).every((item) => item.ok);
console.log(
  JSON.stringify(
    {
      ok: okTables && !sourceColumnError && !fetchColumnError && !claimError,
      host: hostKind(url),
      tables: tableResults,
      v2SourceColumns: sourceColumnError ? sourceColumnError.message : "ok",
      v3FetchColumns: fetchColumnError ? fetchColumnError.message : "ok",
      claimRpc: claimError ? claimError.message : "ok",
      completeStepRpc: completeError ? completeError.message : "ok",
    },
    null,
    2,
  ),
);
