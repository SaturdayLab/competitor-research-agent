import { describe, expect, it } from "vitest";

import { makePostgresJsonSafe, stripPostgresNulls } from "../../src/lib/research/postgres-safe";

describe("PostgreSQL value sanitizing", () => {
  it("removes null characters from text", () => {
    expect(stripPostgresNulls("Cursor\u0000 pricing")).toBe("Cursor pricing");
  });

  it("removes null characters recursively from JSON values", () => {
    expect(makePostgresJsonSafe({ query: "price\u0000", nested: ["a\u0000b"] })).toEqual({
      query: "price",
      nested: ["ab"],
    });
  });
});
