import { describe, expect, it } from "vitest";

import { evaluateCompletedRun, EvaluationInputError } from "@/lib/evaluation/evaluate";
import { MemoryResearchRepository } from "@/lib/research/memory-repository";

const draft = { title: "报告", executiveSummary: "摘要", products: ["A", "B", "C"].map((name) => ({ name, positioning: "定位", strengths: ["优势"], limitations: ["不足"], bestFor: "用户" })), dimensions: [{ name: "定位", summary: "总结", leaders: [] }], conclusion: "结论", limitations: ["局限"] };

async function complete(repository: MemoryResearchRepository, taskId: string) {
  const run = await repository.claimNextRun("worker");
  if (!run) throw new Error("missing run");
  const step = await repository.beginStep(run.id, taskId, "generating", {});
  await repository.completeWorkflow({ taskId, runId: run.id, stepId: step.id, draft, markdown: "# 报告" });
  return run.id;
}

describe("evaluate completed run", () => {
  it("loads only the specified run bundle for repeated task runs", async () => {
    const repository = new MemoryResearchRepository();
    const task = await repository.createTask({ topic: "测试主题", competitors: ["A", "B", "C"] });
    const first = await complete(repository, task.id);
    await repository.enqueueTask(task.id);
    const second = await complete(repository, task.id);
    const firstBundle = await repository.getRunBundle(first);
    const secondBundle = await repository.getRunBundle(second);
    expect(firstBundle?.steps).toHaveLength(1);
    expect(secondBundle?.steps).toHaveLength(1);
    expect(firstBundle?.report?.runId).toBe(first);
    expect(secondBundle?.report?.runId).toBe(second);
  });

  it("rejects missing and incomplete runs as input errors", async () => {
    const repository = new MemoryResearchRepository();
    await expect(evaluateCompletedRun(repository, "missing")).rejects.toBeInstanceOf(EvaluationInputError);
    const task = await repository.createTask({ topic: "测试主题", competitors: ["A", "B", "C"] });
    const queued = await repository.claimNextRun("worker");
    expect(queued?.taskId).toBe(task.id);
    await expect(evaluateCompletedRun(repository, queued!.id)).rejects.toThrow("尚未完成");
  });
});
