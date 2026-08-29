import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadLocalEnv } from "@/lib/env/load-local";

describe("loadLocalEnv", () => {
  it("loads missing keys from a dotenv file and does not override existing values", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-env-"));
    const filePath = join(directory, ".env.local");
    writeFileSync(
      filePath,
      [
        "# comment",
        "",
        "NEW_LOCAL_KEY=from-file",
        "EXISTING_LOCAL_KEY=from-file",
        'QUOTED_LOCAL_KEY="quoted value"',
      ].join("\n"),
      "utf8",
    );

    const previousExisting = process.env.EXISTING_LOCAL_KEY;
    const previousNew = process.env.NEW_LOCAL_KEY;
    const previousQuoted = process.env.QUOTED_LOCAL_KEY;
    process.env.EXISTING_LOCAL_KEY = "already-set";
    delete process.env.NEW_LOCAL_KEY;
    delete process.env.QUOTED_LOCAL_KEY;

    try {
      const loaded = loadLocalEnv(filePath);
      expect(loaded).toEqual(["NEW_LOCAL_KEY", "QUOTED_LOCAL_KEY"]);
      expect(process.env.NEW_LOCAL_KEY).toBe("from-file");
      expect(process.env.QUOTED_LOCAL_KEY).toBe("quoted value");
      expect(process.env.EXISTING_LOCAL_KEY).toBe("already-set");
    } finally {
      restoreEnv("EXISTING_LOCAL_KEY", previousExisting);
      restoreEnv("NEW_LOCAL_KEY", previousNew);
      restoreEnv("QUOTED_LOCAL_KEY", previousQuoted);
    }
  });

  it("returns an empty list when the file is missing", () => {
    expect(loadLocalEnv(join(tmpdir(), "missing-research-env.env"))).toEqual([]);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
