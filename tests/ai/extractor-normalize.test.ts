import { describe, expect, it } from "vitest";

import { normalizeExtractedEvidence } from "@/lib/ai/extractor";
import type { ResearchSource } from "@/lib/domain/research";

function source(): ResearchSource {
  return {
    id: "src-1",
    taskId: "task-1",
    runId: "run-1",
    product: "Cursor",
    title: "Cursor",
    url: "https://cursor.com",
    canonicalUrl: "https://cursor.com/",
    snippet: "AI editor",
    sourceType: "search_result",
    isOfficial: true,
    retrievedAt: "2026-08-27T00:00:00.000Z",
    metadata: {},
    extractedText: "Hobby is $20 per month.",
    fetchStatus: "ok",
    fetchError: null,
  };
}

const input = {
  topic: "AI Coding",
  competitors: ["Cursor", "Claude Code", "Codex"],
  sources: [source()],
};

describe("normalizeExtractedEvidence", () => {
  it("accepts snake_case fields, string confidence, and an evidence wrapper", () => {
    const evidence = normalizeExtractedEvidence(
      {
        evidence: [
          {
            source_id: "src-1",
            product: "Cursor",
            dimension: "价格",
            value: "$20",
            evidence_text: "Hobby is $20 per month.",
            confidence: "0.8",
          },
        ],
      },
      input,
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.sourceId).toBe("src-1");
    expect(evidence[0]?.confidence).toBe(0.8);
  });

  it("keeps valid rows when some rows are malformed", () => {
    const evidence = normalizeExtractedEvidence(
      {
        items: [
          { product: "Cursor" },
          {
            sourceId: "src-1",
            product: "Cursor",
            dimension: "定位",
            evidenceText: `${"很长摘录".repeat(800)}`,
          },
        ],
      },
      input,
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.evidenceText.length).toBeLessThanOrEqual(2000);
  });

  it("maps S1 or a source URL back to the source id", () => {
    const fromIndex = normalizeExtractedEvidence(
      [
        {
          sourceId: "S1",
          product: "Cursor",
          dimension: "价格",
          evidenceText: "Hobby is $20 per month.",
        },
      ],
      input,
    );
    const fromUrl = normalizeExtractedEvidence(
      [
        {
          sourceId: "https://cursor.com",
          product: "Cursor",
          dimension: "价格",
          evidenceText: "Hobby is $20 per month.",
        },
      ],
      input,
    );
    expect(fromIndex[0]?.sourceId).toBe("src-1");
    expect(fromUrl[0]?.sourceId).toBe("src-1");
  });
});
