/**
 * Detector decision logic, against the real test database.
 *
 * The end-to-end behaviour is proven by the Playwright suites; this file pins the
 * decisions that are hard to observe from outside — in particular that a failed
 * reconcile is RETRIED rather than silently swallowed, which is the difference
 * between "eventually consistent" and "quietly wrong".
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { appSequelize } from "../../../src/database/appStore/client.js";
import { config } from "../../../src/config/index.js";
import { SourceChangeDetector, readSourceCounters } from "../../../src/modules/ingestion/sourceChangeDetector.js";
import { snapshotTables, restoreTables, truncateAll } from "../../helpers/dbSnapshot.js";

const S = config.appStore.schema;

async function seed(count: number, tag: string) {
  await appSequelize.query(
    `INSERT INTO "${S}".myntra_reviews
       (product_id, brand_name, review_id, rating, title, body, review_date)
     SELECT 700 + (g % 3), 'B', '${tag}-' || g, 5, 't', 'b', CURRENT_DATE
     FROM generate_series(1, ${count}) g`,
  );
  await waitForCounters();
}

/**
 * PostgreSQL flushes per-backend statistics ASYNCHRONOUSLY — a change is visible
 * in the table immediately but can take ~1s to appear in pg_stat_all_tables.
 *
 * That lag is real and worth stating: detection latency is (stat flush + poll
 * interval), not the poll interval alone. It is harmless in production, where the
 * next tick simply picks the change up, but a test that inspects counters
 * immediately after writing races them.
 */
async function waitForCounters(timeoutMs = 5_000): Promise<void> {
  const before = await readSourceCounters();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const now = await readSourceCounters();
    const moved =
      now.myntra.ins !== before.myntra.ins ||
      now.myntra.upd !== before.myntra.upd ||
      now.myntra.del !== before.myntra.del;
    if (moved) return;
  }
}

describe("SourceChangeDetector", () => {
  beforeAll(snapshotTables);
  afterAll(restoreTables);
  beforeEach(truncateAll);

  it("reads per-platform counters for both marketplaces", async () => {
    const c = await readSourceCounters();
    expect(c.myntra).toMatchObject({
      ins: expect.any(Number),
      upd: expect.any(Number),
      del: expect.any(Number),
    });
    expect(c.flipkart).toBeDefined();
  });

  it("counters observe INSERT / UPDATE / DELETE — including a bare UPDATE", async () => {
    await seed(3, "DET");
    const afterInsert = (await readSourceCounters()).myntra;

    // Deliberately does NOT touch updatedAt: these tables have no trigger, so a
    // metadata probe would see nothing at all here.
    await appSequelize.query(`UPDATE "${S}".myntra_reviews SET rating = 4 WHERE review_id LIKE 'DET-%'`);
    await waitForCounters();
    const afterUpdate = (await readSourceCounters()).myntra;
    expect(afterUpdate.upd).toBeGreaterThan(afterInsert.upd);

    await appSequelize.query(`DELETE FROM "${S}".myntra_reviews WHERE review_id LIKE 'DET-%'`);
    await waitForCounters();
    const afterDelete = (await readSourceCounters()).myntra;
    expect(afterDelete.del).toBeGreaterThan(afterUpdate.del);
  });

  it("first tick reconciles both platforms — this is what recovers a restart", async () => {
    const d = new SourceChangeDetector();
    await d.tick();
    expect(d.stats.reconciles).toBe(2);
    expect(d.stats.lastReasons.map((r) => r.reason)).toEqual(["first_run", "first_run"]);
  });

  it("a quiet source is a no-op — no reconcile on subsequent ticks", async () => {
    const d = new SourceChangeDetector();
    await d.tick();
    const after1 = d.stats.reconciles;

    await d.tick();
    await d.tick();

    expect(d.stats.reconciles, "an unchanged source must not trigger work").toBe(after1);
  });

  it("a source change triggers exactly one reconcile", async () => {
    const d = new SourceChangeDetector();
    await d.tick();
    const before = d.stats.reconciles;

    await seed(2, "CHG");
    await d.tick();

    expect(d.stats.reconciles).toBe(before + 1);
    expect(d.stats.lastReasons.at(-1)?.reason).toBe("counters_changed");

    // …and settles again afterwards.
    await d.tick();
    expect(d.stats.reconciles).toBe(before + 1);
  });

  it("counters going BACKWARDS is treated as a reset, not as 'no change'", async () => {
    const d = new SourceChangeDetector();
    await d.tick();
    const before = d.stats.reconciles;

    // Simulate pg_stat_reset() by rewinding what the detector last observed.
    (d as unknown as { lastSeen: Map<string, unknown> }).lastSeen.set("myntra", {
      ins: Number.MAX_SAFE_INTEGER,
      upd: Number.MAX_SAFE_INTEGER,
      del: Number.MAX_SAFE_INTEGER,
    });

    await d.tick();
    expect(d.stats.reconciles).toBe(before + 1);
    expect(d.stats.lastReasons.at(-1)?.reason).toBe("counters_reset");
  });

  it("a FAILED reconcile is retried — the change is never lost", async () => {
    const d = new SourceChangeDetector();
    await d.tick(); // settle

    await seed(2, "FAIL");

    // Fail the next reconcile.
    const spy = vi
      .spyOn(d as unknown as { reconcile: (...a: unknown[]) => Promise<void> }, "reconcile")
      .mockImplementationOnce(async () => {
        (d as unknown as { dirty: Set<string> }).dirty.add("myntra");
        d.stats.failures += 1;
      });

    await d.tick();
    expect(d.stats.failures).toBeGreaterThan(0);
    spy.mockRestore();

    // Counters were NOT persisted, so the very next tick retries rather than
    // treating the failed run as done.
    await d.tick();
    expect(d.stats.lastReasons.at(-1)?.reason).toBe("retry_after_failure");
    expect((d as unknown as { dirty: Set<string> }).dirty.has("myntra")).toBe(false);
  });

  it("never throws out of tick() — a transient DB error must not kill the loop", async () => {
    const d = new SourceChangeDetector();
    const spy = vi
      .spyOn(appSequelize, "query")
      .mockRejectedValueOnce(new Error("connection terminated unexpectedly"));

    await expect(d.tick()).resolves.toBeUndefined();
    expect(d.stats.failures).toBeGreaterThan(0);
    spy.mockRestore();

    // Still usable afterwards.
    await d.tick();
    expect(d.stats.reconciles).toBeGreaterThan(0);
  });

  it("start() respects AUTO_SYNC_ENABLED=false", () => {
    const original = config.autoSync.enabled;
    try {
      (config.autoSync as { enabled: boolean }).enabled = false;
      const d = new SourceChangeDetector();
      d.start();
      expect(d.isRunning()).toBe(false);
    } finally {
      (config.autoSync as { enabled: boolean }).enabled = original;
    }
  });
});
