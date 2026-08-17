/**
 * Phase 6 Step 2 — in-process, short-TTL memoization cache for Category C
 * endpoints (see phase-6-api-architecture-design.md §2). Deliberately not
 * Redis or any external cache — no such infrastructure exists anywhere in
 * this codebase, and the "caching infra" question was never resolved. This
 * is fully reversible: deleting this file and its call sites reverts every
 * consumer to naive live computation with no other change.
 *
 * Known, disclosed limitation: state is per-process. A multi-instance
 * deployment would not share cache entries across instances — acceptable
 * today since the "hosting target" decision is also still open, but a real
 * constraint to revisit before horizontal scaling.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Returns a cached value if fresh; otherwise computes, caches, and returns it. */
  async getOrCompute(key: string, compute: () => Promise<T>, ttlMs: number = this.defaultTtlMs): Promise<{ value: T; cacheHit: boolean }> {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, cacheHit: true };
    const value = await compute();
    this.set(key, value, ttlMs);
    return { value, cacheHit: false };
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Phase 6 Step 2 — evidence-based default TTL. Derived from the real
 * catalog-wide (1,004 products) timing benchmark (scripts/phase6CategoryCBenchmark.ts,
 * PROVEN BY EXECUTION): computeHealthScore full-catalog loop 1,100.9ms,
 * computeProductAnalytics full-catalog loop 451.4ms, detectAllProductSignals
 * 1,730.6ms, computeProblemsAggregate 197.0ms. The slowest of these is under
 * 2 seconds even at full real-catalog scale and pool-realistic concurrency
 * (5, matching the app store's default Sequelize pool size) — this is not a
 * "computation is slow" cache, it exists to absorb bursts of near-simultaneous
 * requests (e.g. several dashboard viewers loading within the same window)
 * without recomputing per request. 60s is long enough to meaningfully
 * collapse repeated/concurrent load (a request storm within the same minute
 * costs one real computation instead of N) while keeping staleness bounded
 * to a duration far shorter than any of this platform's analysis windows
 * (minimum 7d) — not a measured optimum, a reasoned choice from the
 * measured cost, same "evidence, not guess" discipline Phase 5's Step 4
 * threshold tuning used.
 */
export const CATEGORY_C_DEFAULT_TTL_MS = 60_000;
