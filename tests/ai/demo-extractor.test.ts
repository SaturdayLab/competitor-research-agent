import { describe, expect, it } from "vitest";

import { DemoEvidenceExtractor } from "@/lib/ai/demo-extractor";
import { normalizeExtractedEvidence } from "@/lib/ai/extractor";
import type { ResearchSource } from "@/lib/domain/research";

function source(overrides: Partial<ResearchSource>): ResearchSource {
  return {
    id: "src-1",
    taskId: "task-1",
    runId: "run-1",
    product: "Cursor",
    title: "Cursor pricing",
    url: "https://cursor.com/pricing",
    canonicalUrl: "https://cursor.com/pricing",
    snippet: "Plans",
    sourceType: "search_result",
    isOfficial: true,
    retrievedAt: "2026-08-27T00:00:00.000Z",
    metadata: {},
    extractedText: "Hobby is $20 per month for individuals.",
    fetchStatus: "ok",
    fetchError: null,
    ...overrides,
  };
}

describe("DemoEvidenceExtractor", () => {
  it("emits one evidence item per readable source using the page text", async () => {
    const extractor = new DemoEvidenceExtractor();
    const raw = await extractor.extract({
      topic: "AI Coding 产品分析",
      competitors: ["Cursor", "Claude Code", "Codex"],
      focus: "价格、Agent 能力",
      sources: [
        source({}),
        source({
          id: "src-2",
          product: "Claude Code",
          extractedText: "Claude Code runs in the terminal.",
        }),
      ],
    });
    const evidence = normalizeExtractedEvidence(raw, {
      topic: "AI Coding 产品分析",
      competitors: ["Cursor", "Claude Code", "Codex"],
      sources: [source({}), source({ id: "src-2", product: "Claude Code", extractedText: "Claude Code runs in the terminal." })],
    });

    expect(evidence).toHaveLength(2);
    expect(evidence.map((item) => item.product)).toEqual(["Cursor", "Claude Code"]);
    expect(evidence[0]?.dimension).toBe("价格");
    expect(evidence[0]?.evidenceText).toContain("Hobby is $20");
    expect(evidence[1]?.evidenceText).toContain("terminal");
  });

  it("drops evidence whose product is not a requested competitor", () => {
    const evidence = normalizeExtractedEvidence(
      [
        {
          sourceId: "src-1",
          product: "NotAProduct",
          dimension: "价格",
          value: "$20",
          evidenceText: "Hobby is $20 per month for individuals.",
        },
        {
          sourceId: "src-1",
          product: "Cursor",
          dimension: "价格",
          value: "$20",
          evidenceText: "Hobby is $20 per month for individuals.",
        },
      ],
      {
        topic: "AI Coding",
        competitors: ["Cursor", "Claude Code", "Codex"],
        sources: [source({})],
      },
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.product).toBe("Cursor");
  });

  it("uses the first planned dimension when a plan is present", async () => {
    const raw = await new DemoEvidenceExtractor().extract({
      topic: "协同办公",
      competitors: ["Cursor", "Claude Code", "Codex"],
      focus: "旧关注点",
      dimensions: ["产品定位", "定价", "集成生态"],
      sources: [source({})],
    });
    expect(raw[0]?.dimension).toBe("产品定位");
  });
});
