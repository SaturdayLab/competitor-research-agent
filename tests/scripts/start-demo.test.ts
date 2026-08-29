import { describe, expect, it } from "vitest";

import { getDemoProcesses } from "../../scripts/start-demo";

describe("getDemoProcesses", () => {
  it("starts the Next.js web app and the research worker", () => {
    const processes = getDemoProcesses("C:/project");

    expect(processes.map((item) => item.name)).toEqual(["Web", "Worker"]);
    expect(processes[0]?.entry.replaceAll("\\", "/")).toContain("node_modules/next/dist/bin/next");
    expect(processes[0]?.args).toEqual(["dev"]);
    expect(processes[1]?.entry.replaceAll("\\", "/")).toContain("node_modules/tsx/dist/cli.mjs");
    expect(processes[1]?.args[0]?.replaceAll("\\", "/")).toBe("C:/project/src/worker/run-worker.ts");
  });
});
