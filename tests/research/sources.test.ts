import { describe, expect, it } from "vitest";

import { MemoryResearchRepository } from "@/lib/research/memory-repository";

describe("research source persistence", () => {
  it("deduplicates canonical URLs inside a run and exposes the source count", async () => {
    const repository = new MemoryResearchRepository();
    const task = await repository.createTask({
      topic: "AI coding assistants",
      competitors: ["Cursor", "GitHub Copilot", "Windsurf"],
    });
    const run = await repository.claimNextRun("source-test-worker");
    if (!run) throw new Error("Expected a claimed run");
    const step = await repository.beginStep(run.id, task.id, "researching", { provider: "test" });

    const sources = await repository.saveSources(task.id, run.id, [
      {
        product: "Cursor",
        title: "Cursor pricing",
        url: "https://cursor.com/pricing?utm_source=test",
        canonicalUrl: "https://cursor.com/pricing",
        snippet: "Pricing overview",
        sourceType: "search_result",
        isOfficial: true,
        metadata: { query: "Cursor official pricing", rank: 1 },
      },
      {
        product: "Cursor",
        title: "Duplicate",
        url: "https://cursor.com/pricing/",
        canonicalUrl: "https://cursor.com/pricing",
        snippet: "Duplicate result",
        sourceType: "search_result",
        isOfficial: true,
        metadata: { query: "Cursor official pricing", rank: 2 },
      },
    ]);

    expect(sources).toHaveLength(1);
    expect(await repository.listSources(task.id, run.id)).toHaveLength(1);
    expect((await repository.getTaskDetail(task.id))?.sourceCount).toBe(1);

    await repository.completeStep(step.id, { sourceCount: 1 });
    const detail = await repository.getTaskDetail(task.id);
    expect(detail?.steps[0]).toMatchObject({ status: "completed", output: { sourceCount: 1 } });
  });

  it("rejects sources attached to a different task or inactive run", async () => {
    const repository = new MemoryResearchRepository();
    const first = await repository.createTask({
      topic: "AI coding assistants",
      competitors: ["Cursor", "GitHub Copilot", "Windsurf"],
    });
    const second = await repository.createTask({
      topic: "Team collaboration",
      competitors: ["Slack", "Teams", "Lark"],
    });
    const run = await repository.claimNextRun("source-test-worker");
    if (!run) throw new Error("Expected a claimed run");

    await expect(repository.saveSources(second.id, run.id, [])).rejects.toThrow(
      "工作流不属于该任务",
    );
    expect(run.taskId).toBe(first.id);
  });
});

