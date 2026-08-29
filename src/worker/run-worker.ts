import { z } from "zod";

import {
  getEvidenceExtractor,
  getGapQueryPlanner,
  getResearchAnalyst,
  getResearchGenerator,
  getResearchInvestigator,
  getResearchPlanner,
  getResearchReviewer,
} from "@/lib/ai/factory";
import { loadLocalEnv } from "@/lib/env/load-local";
import { toErrorMessage } from "@/lib/errors";
import { createPageReader } from "@/lib/read/factory";
import { getResearchRepository } from "@/lib/research/repository-factory";
import { runClaimedWorkflow } from "@/lib/research/workflow";
import { createSearchProvider } from "@/lib/search/factory";

const loadedLocalKeys = loadLocalEnv();

const WorkerConfigSchema = z.object({
  workerId: z.string().trim().min(1),
  pollIntervalMs: z.number().int().min(250).max(60_000),
});

const config = WorkerConfigSchema.parse({
  workerId: process.env.WORKER_ID || `worker-${process.pid}`,
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1500),
});

let stopping = false;

function log(level: "info" | "error", message: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    workerId: config.workerId,
    message,
    ...data,
  });
  if (level === "error") console.error(entry);
  else console.log(entry);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    log("info", "停止信号已接收，当前任务完成后退出", { signal });
  });
}

async function main() {
  const repository = getResearchRepository();
  const generator = getResearchGenerator();
  const searchProvider = createSearchProvider();
  const pageReader = createPageReader();
  const extractor = getEvidenceExtractor();
  const investigator = getResearchInvestigator();
  const reviewer = getResearchReviewer();
  const planner = getResearchPlanner();
  const analyst = getResearchAnalyst();
  const gapQueryPlanner = getGapQueryPlanner();
  log("info", "Research Worker 已启动", {
    provider: generator.name,
    searchProvider: searchProvider.name,
    pageReader: pageReader.name,
    extractor: extractor.name,
    investigator: investigator.name,
    reviewer: reviewer.name,
    planner: planner.name,
    analyst: analyst.name,
    gapQueryPlanner: gapQueryPlanner.name,
    localEnvKeys: loadedLocalKeys.length,
  });

  while (!stopping) {
    try {
      const run = await repository.claimNextRun(config.workerId);
      if (!run) {
        await delay(config.pollIntervalMs);
        continue;
      }

      log("info", "开始执行调研任务", { runId: run.id, taskId: run.taskId });
      try {
        const report = await runClaimedWorkflow(
          repository,
          generator,
          run,
          searchProvider,
          pageReader,
          extractor,
          investigator,
          reviewer,
          planner,
          analyst,
          gapQueryPlanner,
        );
        log("info", "调研任务执行完成", {
          runId: run.id,
          taskId: run.taskId,
          reportId: report.id,
        });
      } catch (error) {
        log("error", "调研任务执行失败", {
          runId: run.id,
          taskId: run.taskId,
          error: toErrorMessage(error),
        });
      }
    } catch (error) {
      log("error", "Worker 轮询失败", { error: toErrorMessage(error) });
      await delay(Math.min(config.pollIntervalMs * 2, 10_000));
    }
  }

  log("info", "Research Worker 已停止");
}

main().catch((error) => {
  log("error", "Research Worker 无法启动", { error: toErrorMessage(error) });
  process.exitCode = 1;
});
