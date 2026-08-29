import { describe, expect, it } from "vitest";
import { DemoGapQueryPlanner } from "@/lib/ai/demo-gap-query-planner";
import { findEvidenceGaps, normalizeGapQueries, selectEvidenceGaps } from "@/lib/ai/gap-investigator";
import type { ResearchEvidence } from "@/lib/domain/research";

const evidence = (product: string, dimension: string): ResearchEvidence => ({ id: `${product}-${dimension}`, taskId: "t", sourceId: "s", product, dimension, value: {}, evidenceText: "证据", confidence: 1, createdAt: "2026-08-28T00:00:00Z" });

describe("evidence gap selection", () => {
  it("uses dimension then competitor order and at most one gap per product", () => {
    const gaps = findEvidenceGaps(["A", "B", "C"], ["定位", "定价"], [evidence("A", "定位")]);
    expect(gaps).toEqual([{ product: "B", dimension: "定位" }, { product: "C", dimension: "定位" }, { product: "A", dimension: "定价" }, { product: "B", dimension: "定价" }, { product: "C", dimension: "定价" }]);
    expect(selectEvidenceGaps(gaps)).toEqual([{ product: "B", dimension: "定位" }, { product: "C", dimension: "定位" }, { product: "A", dimension: "定价" }]);
  });

  it("matches existing evidence case-insensitively", () => {
    expect(findEvidenceGaps([" Alpha "], ["定位"], [evidence("alpha", " 定位 ")])).toEqual([]);
  });

  it("rejects only queries missing the product or dimension", () => {
    const selected = [{ product: "A", dimension: "定位" }, { product: "B", dimension: "定价" }];
    expect(normalizeGapQueries({ queries: [{ product: "A", dimension: "定位", query: "A 定位 官网" }, { product: "B", dimension: "定价", query: "B 官网" }] }, selected)).toEqual({ valid: [{ product: "A", dimension: "定位", query: "A 定位 官网" }], invalid: [{ product: "B", dimension: "定价" }] });
  });

  it("accepts harmless whitespace inside a dimension name", () => {
    const selected = [{ product: "Slack", dimension: "文档协作与知识管理" }];
    expect(normalizeGapQueries({ queries: [{ ...selected[0], query: "Slack 文档协作 知识管理 功能" }] }, selected).valid).toHaveLength(1);
  });

  it("has deterministic demo queries", async () => {
    const planner = new DemoGapQueryPlanner();
    const input = { topic: "协同办公", gaps: [{ product: "飞书", dimension: "定价" }] };
    expect(await planner.plan(input)).toEqual(await planner.plan(input));
  });
});
