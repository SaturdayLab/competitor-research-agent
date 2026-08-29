import { describe, expect, it, vi } from "vitest";

import { TtlCache } from "@/lib/cache/ttl-cache";

describe("TtlCache", () => {
  it("reuses a value before expiry and reloads it after expiry", async () => {
    let now = 1_000;
    const cache = new TtlCache<string, string>({ ttlMs: 100, maxEntries: 10, now: () => now });
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await expect(cache.getOrCreate("key", load)).resolves.toEqual({ value: "first", hit: false });
    await expect(cache.getOrCreate("key", load)).resolves.toEqual({ value: "first", hit: true });
    now = 1_101;
    await expect(cache.getOrCreate("key", load)).resolves.toEqual({ value: "second", hit: false });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retain a rejected load", async () => {
    const cache = new TtlCache<string, string>({ ttlMs: 100, maxEntries: 10 });
    const load = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce("ok");
    await expect(cache.getOrCreate("key", load)).rejects.toThrow("failed");
    await expect(cache.getOrCreate("key", load)).resolves.toEqual({ value: "ok", hit: false });
  });
});
