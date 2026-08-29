import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../supabase/migrations/202608270001_initial_research_schema.sql",
  import.meta.url,
);
const v2MigrationPath = new URL(
  "../../supabase/migrations/202608270002_v2_search_sources.sql",
  import.meta.url,
);
const v3MigrationPath = new URL(
  "../../supabase/migrations/202608270003_v3_page_reader_evidence.sql",
  import.meta.url,
);
const v4MigrationPath = new URL(
  "../../supabase/migrations/202608280004_gap_filling_step.sql",
  import.meta.url,
);
const twoCompetitorMigrationPath = new URL(
  "../../supabase/migrations/202608290006_two_competitor_minimum.sql",
  import.meta.url,
);

describe("initial research schema", () => {
  it("keeps the queue claim non-blocking and atomic", async () => {
    const sql = (await readFile(migrationPath, "utf8")).toLowerCase();

    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("workflow_runs_one_active_per_task_idx");
    expect(sql).toContain("create or replace function public.claim_next_workflow_run");
  });

  it("enables RLS and indexes the evidence foreign keys", async () => {
    const sql = (await readFile(migrationPath, "utf8")).toLowerCase();

    expect(sql).toContain("alter table public.research_tasks enable row level security");
    expect(sql).toContain("alter table public.research_evidence enable row level security");
    expect(sql).toContain("research_evidence_task_dimension_idx");
    expect(sql).toContain("research_evidence_source_idx");
  });
});

describe("V2 search source migration", () => {
  it("links sources to runs and keeps run URLs idempotent", async () => {
    const sql = (await readFile(v2MigrationPath, "utf8")).toLowerCase();

    expect(sql).toContain("add column if not exists run_id bigint");
    expect(sql).toContain("research_sources_run_id_idx");
    expect(sql).toContain("research_sources_run_canonical_url_idx");
    expect(sql).toContain("create or replace function public.complete_research_step");
    expect(sql).toContain("grant execute on function public.complete_research_step");
  });
});

describe("V3 page reader evidence migration", () => {
  it("adds source fetch fields without rewriting the initial schema", async () => {
    const sql = (await readFile(v3MigrationPath, "utf8")).toLowerCase();

    expect(sql).toContain("extracted_text");
    expect(sql).toContain("fetch_status");
    expect(sql).toContain("fetch_error");
    expect(sql).toContain("pending");
    expect(sql).not.toContain("drop table");
  });
});

describe("V7 gap filling step migration", () => {
  it("adds gap_filling to task and step checks without creating tables", async () => {
    const sql = (await readFile(v4MigrationPath, "utf8")).toLowerCase();
    expect(sql).toContain("research_tasks_current_step_check");
    expect(sql).toContain("research_steps_step_type_check");
    expect(sql.match(/'gap_filling'/g)).toHaveLength(2);
    expect(sql).not.toContain("create table");
  });
});

describe("two competitor minimum migration", () => {
  it("relaxes only the competitor count check to two through six", async () => {
    const sql = (await readFile(twoCompetitorMigrationPath, "utf8")).toLowerCase();
    expect(sql).toContain("drop constraint if exists research_tasks_competitors_check");
    expect(sql).toContain("jsonb_array_length(competitors) between 2 and 6");
    expect(sql).not.toContain("drop table");
  });
});
