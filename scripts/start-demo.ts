import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type DemoProcess = {
  name: string;
  entry: string;
  args: string[];
};

export function getDemoProcesses(root = process.cwd()): DemoProcess[] {
  return [
    { name: "Web", entry: resolve(root, "node_modules/next/dist/bin/next"), args: ["dev"] },
    {
      name: "Worker",
      entry: resolve(root, "node_modules/tsx/dist/cli.mjs"),
      args: [resolve(root, "src/worker/run-worker.ts")],
    },
  ];
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href,
);

if (isMain && process.argv.includes("--help")) {
  console.log("npm run demo：同时启动 Next.js 网页和 Research Worker，按 Ctrl+C 一起关闭。");
} else if (isMain) {
  const processes = getDemoProcesses();
  const children: ChildProcess[] = [];
  let shuttingDown = false;

  function stopAll(signal: NodeJS.Signals, exitCode: number): void {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
    Promise.all(children.map((child) => new Promise<void>((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) resolveExit();
      else child.once("exit", () => resolveExit());
    }))).finally(() => process.exit(exitCode));
  }

  for (const item of processes) {
    const child = spawn(process.execPath, [item.entry, ...item.args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    children.push(child);
    child.once("error", (error) => {
      console.error(`[Demo] ${item.name} 启动失败：${error.message}`);
      stopAll("SIGTERM", 1);
    });
    child.once("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(`[Demo] ${item.name} 已退出（${signal ?? code ?? "unknown"}），正在关闭另一进程。`);
        stopAll("SIGTERM", code ?? 1);
      }
    });
  }

  console.log("[Demo] 网页与 Worker 正在启动。访问 http://localhost:3000，按 Ctrl+C 一起关闭。");
  process.once("SIGINT", () => stopAll("SIGINT", 0));
  process.once("SIGTERM", () => stopAll("SIGTERM", 0));
}
