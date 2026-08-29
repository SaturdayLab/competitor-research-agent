type CacheEntry<Value> = {
  expiresAt: number;
  value: Promise<Value>;
};

export class TtlCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs: number; maxEntries: number; now?: () => number }) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  async getOrCreate(key: Key, load: () => Promise<Value>): Promise<{ value: Value; hit: boolean }> {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      return { value: await existing.value, hit: true };
    }
    if (existing) this.entries.delete(key);

    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(entryKey);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    const value = load();
    const entry = { value, expiresAt: now + this.ttlMs };
    this.entries.set(key, entry);
    try {
      return { value: await value, hit: false };
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }
}
