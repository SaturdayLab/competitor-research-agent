import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateCompletedRun, EvaluationInputError } from "@/lib/evaluation/evaluate";
import { formatEvaluationConsole, formatEvaluationMarkdown } from "@/lib/evaluation/format";
import { loadLocalEnv } from "@/lib/env/load-local";
import { getResearchRepository } from "@/lib/research/repository-factory";

function runIdFrom(argv: string[]): string | null {
  const index = argv.indexOf("--run-id");
  const value = index >= 0 ? argv[index + 1]?.trim() : null;
  return value || null;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const runId = runIdFrom(argv);
  if (!runId) { console.error("缺少 --run-id <workflow_runs.public_id>"); return 2; }
  try {
    loadLocalEnv();
    const report = await evaluateCompletedRun(getResearchRepository(), runId);
    const stamp = report.evaluatedAt.replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
    const outputDir = path.join(process.cwd(), "eval", "results", `${stamp}-${runId}`);
    await mkdir(outputDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      writeFile(path.join(outputDir, "summary.md"), formatEvaluationMarkdown(report), "utf8"),
    ]);
    console.log(formatEvaluationConsole(report));
    console.log(`\n输出: ${outputDir}`);
    return report.metrics.some((metric) => metric.status === "error") ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof EvaluationInputError ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
