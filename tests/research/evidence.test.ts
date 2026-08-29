import { describe, expect, it } from "vitest";

import { MemoryResearchRepository } from "@/lib/research/memory-repository";

async function claimedTask() {
  const repository = new MemoryResearchRepository();
  const task = await repository.createTask({
    topic: "AI coding assistants",
    competitors: ["Cursor", "GitHub Copilot", "Windsurf"],
  });
  const run = await repository.claimNextRun("evidence-test-worker");
  if (!run) throw new Error("Expected a claimed run");
  return { repository, task, run };
}

describe("research evidence persistence", () => {
  it("stores fetch results on a source and lists evidence for that run", async () => {
    const { repository, task, run } = await claimedTask();
    const [source] = await repository.saveSources(task.id, run.id, [
      {
        product: "Cursor",
        title: "Cursor pricing",
        url: "https://cursor.com/pricing",
        canonicalUrl: "https://cursor.com/pricing",
        snippet: "Pricing overview",
        sourceType: "search_result",
        isOfficial: true,
        metadata: { query: "Cursor pricing", rank: 1 },
      },
    ]);
    if (!source) throw new Error("Expected a saved source");

    const fetched = await repository.updateSourceFetch(source.id, {
      fetchStatus: "ok",
      extractedText: "Hobby is $20 per month.",
      fetchError: null,
      contentHash: "abc123",
    });
    expect(fetched.fetchStatus).toBe("ok");
    expect(fetched.extractedText).toBe("Hobby is $20 per month.");

    const evidence = await repository.saveEvidence(task.id, [
      {
        sourceId: source.id,
        product: "Cursor",
        dimension: "价格",
        value: { price: "$20" },
        evidenceText: "Hobby is $20 per month.",
        confidence: 0.8,
      },
    ]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      taskId: task.id,
      sourceId: source.id,
      product: "Cursor",
      dimension: "价格",
      evidenceText: "Hobby is $20 per month.",
    });
    expect(await repository.listEvidence(task.id, run.id)).toHaveLength(1);
  });

  it("rejects evidence whose source belongs to a different task", async () => {
    const repository = new MemoryResearchRepository();
    const first = await repository.createTask({
      topic: "AI coding assistants",
      competitors: ["Cursor", "GitHub Copilot", "Windsurf"],
    });
    const second = await repository.createTask({
      topic: "Team collaboration",
      competitors: ["Slack", "Teams", "Lark"],
    });
    const run = await repository.claimNextRun("evidence-test-worker");
    if (!run) throw new Error("Expected a claimed run");
    const [source] = await repository.saveSources(first.id, run.id, [
      {
        product: "Cursor",
        title: "Cursor",
        url: "https://cursor.com",
        canonicalUrl: "https://cursor.com/",
        snippet: "Home",
        sourceType: "search_result",
        isOfficial: true,
        metadata: {},
      },
    ]);
    if (!source) throw new Error("Expected a saved source");

    await expect(
      repository.saveEvidence(second.id, [
        {
          sourceId: source.id,
          product: "Cursor",
          dimension: "定位",
          value: "editor",
          evidenceText: "AI editor",
        },
      ]),
    ).rejects.toThrow("来源不属于该任务");
  });
});
