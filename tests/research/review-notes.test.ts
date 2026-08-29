import { describe, expect, it } from "vitest";

import { readStoredReviewNotes } from "../../src/lib/research/review-notes";

describe("readStoredReviewNotes", () => {
  it("returns notes from a valid stored reviewer output", () => {
    expect(readStoredReviewNotes({
      verdict: "revise",
      notes: ["确认价格是否仍然有效", "补充企业版限制"],
      revisions: 1,
    })).toEqual(["确认价格是否仍然有效", "补充企业版限制"]);
  });

  it("returns no notes for legacy step output", () => {
    expect(readStoredReviewNotes({ title: "旧报告结构" })).toEqual([]);
  });
});
