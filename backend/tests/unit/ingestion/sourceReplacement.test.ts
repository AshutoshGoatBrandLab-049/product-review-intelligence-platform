/**
 * Unit coverage for source-replacement detection and cleanup.
 *
 * Replaces an earlier mock-based version that asserted the OLD ratio-gate
 * algorithm — including cases that encoded the data-corruption bug as expected
 * behaviour ("no overlap but count ratio ~1.0x → not a replacement" is exactly
 * the same-size replacement that must now be caught, and "conservatively handles
 * errors by returning false" is the error-swallowing that let a schema mismatch
 * masquerade as 'no replacement'). Those assertions could not be carried over
 * without re-asserting the defect.
 *
 * Runs against the real PostgreSQL test database rather than mocked query
 * sequences, so it verifies behaviour instead of an implementation's SQL shape.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { QueryTypes } from "sequelize";
import { appSequelize } from "../../../src/database/appStore/client.js";
import { config } from "../../../src/config/index.js";
import {
  getReplacementSignals,
  detectSourceReplacement,
  cleanupStaleSourceData,
  RETENTION_REPLACEMENT_THRESHOLD,
} from "../../../src/modules/ingestion/sourceReplacement.js";
import { snapshotTables, restoreTables, truncateAll } from "../../helpers/dbSnapshot.js";
import type { Platform } from "../../../src/types/unifiedReview.js";

const S = config.appStore.schema;

/** Insert `count` source rows; `tag` controls composite identity. */
async function seedSource(platform: Platform, count: number, tag: string, startId = 1) {
  if (platform === "myntra") {
    await appSequelize.query(
      `INSERT INTO "${S}".myntra_reviews
         (id, product_id, brand_name, review_id, rating, title, body, review_date)
       SELECT $2 + g, 100 + (g % 5), 'B', $3 || '-r' || g, 1 + (g % 5),
              't', 'b', DATE '2026-06-01'
       FROM generate_series(0, $1 - 1) g`,
      { bind: [count, startId, tag] },
    );
  } else {
    await appSequelize.query(
      `INSERT INTO "${S}".flipkart_reviews
         (id, pid, brand_name, review_id, rating, title, comment, review_date)
       SELECT $2 + g, 'P' || (100 + (g % 5)), 'B', $3 || '-r' || g, 1 + (g % 5),
              't', 'c', DATE '2026-06-01'
       FROM generate_series(0, $1 - 1) g`,
      { bind: [count, startId, tag] },
    );
  }
}

/** Insert canonical rows mirroring a source tag (or a tag that never existed). */
async function seedCanonical(platform: Platform, count: number, tag: string) {
  const pidExpr = platform === "myntra" ? `(100 + (g % 5))::text` : `'P' || (100 + (g % 5))`;
  await appSequelize.query(
    `INSERT INTO "${S}".normalized_reviews
       (canonical_review_id, platform, source_product_id, source_review_id, source_row_id,
        identity_confidence, rating, review_date, date_confidence, content_hash,
        source_updated_at, mapper_version)
     SELECT md5($3 || '-' || g), $2, ${pidExpr}, $3 || '-r' || g, g,
            'native', 3, DATE '2026-06-01', 'exact', md5('h' || $3 || g), now(), 1
     FROM generate_series(0, $1 - 1) g`,
    { bind: [count, platform, tag] },
  );
}

const one = async (sql: string, bind: unknown[] = []) =>
  ((await appSequelize.query(sql, { type: QueryTypes.SELECT, bind })) as any[])[0];

describe("sourceReplacement — detection", () => {
  beforeAll(snapshotTables);
  afterAll(restoreTables);
  beforeEach(truncateAll);

  it("empty source is never a replacement (refuses to wipe canonical)", async () => {
    await seedCanonical("myntra", 100, "OLD");
    const s = await getReplacementSignals("myntra");
    expect(s.sourceCount).toBe(0);
    expect(s.isReplacement).toBe(false);
    expect(s.reason).toBe("source_empty");
  });

  it("empty canonical is never a replacement (first-time ingestion)", async () => {
    await seedSource("myntra", 100, "NEW");
    const s = await getReplacementSignals("myntra");
    expect(s.canonicalCount).toBe(0);
    expect(s.isReplacement).toBe(false);
    expect(s.reason).toBe("canonical_empty_first_ingestion");
  });

  it("retention is computed from COMPOSITE identity, not bare review_id", async () => {
    // Same review_id values, DIFFERENT products → composite identity does not match.
    await seedCanonical("myntra", 50, "SAME");
    await appSequelize.query(
      `UPDATE "${S}".normalized_reviews SET source_product_id = 'other-' || source_product_id`,
    );
    await seedSource("myntra", 50, "SAME");

    const s = await getReplacementSignals("myntra");
    expect(s.retainedCount, "bare review_id would wrongly match all 50").toBe(0);
    expect(s.retention).toBe(0);
    expect(s.isReplacement).toBe(true);
  });

  it("full identity overlap → retention 1.0, not a replacement", async () => {
    await seedCanonical("myntra", 100, "A");
    await seedSource("myntra", 100, "A");
    const s = await getReplacementSignals("myntra", undefined, { exact: true });
    expect(s.retainedCount).toBe(100);
    expect(s.retention).toBe(1);
    expect(s.retentionExact).toBe(true);
    expect(s.isReplacement).toBe(false);
    expect(s.reason).toBe("retention_normal_incremental");
  });

  it("bounded scan stops early on the common path but reports it honestly", async () => {
    await seedCanonical("myntra", 100, "A");
    await seedSource("myntra", 100, "A");

    const fast = await getReplacementSignals("myntra");
    // cap = floor(0.05 * 100) + 1 = 6 — counting stops there instead of at 100.
    expect(fast.retainedCount).toBe(6);
    expect(fast.retentionExact, "a lower bound must never be reported as exact").toBe(false);
    expect(fast.isReplacement).toBe(false);
  });

  it("EQUIVALENCE: bounded and exact scans always agree on the verdict", async () => {
    // Across the full spectrum of retention, the optimisation must not change
    // a single verdict — only how much work is done reaching it.
    for (const [canonicalRows, sourceRows] of [
      [100, 0],    // retention 0.00 → replacement
      [100, 2],    // retention 0.02 → replacement
      [100, 5],    // retention 0.05 → boundary, NOT a replacement
      [100, 6],    // retention 0.06 → not a replacement
      [100, 50],   // retention 0.50 → not a replacement
      [100, 100],  // retention 1.00 → not a replacement
    ] as const) {
      await truncateAll();
      await seedCanonical("myntra", canonicalRows, "A");
      if (sourceRows > 0) await seedSource("myntra", sourceRows, "A");
      // Keep source non-empty so the empty-source guard doesn't short-circuit.
      if (sourceRows === 0) await seedSource("myntra", 10, "OTHER");

      const fast = await getReplacementSignals("myntra");
      const exact = await getReplacementSignals("myntra", undefined, { exact: true });

      expect(
        fast.isReplacement,
        `verdict mismatch at canonical=${canonicalRows} source=${sourceRows} ` +
          `(fast retained=${fast.retainedCount}, exact retained=${exact.retainedCount})`,
      ).toBe(exact.isReplacement);
    }
  });

  it("zero overlap → replacement regardless of count ratio", async () => {
    // ratio 1.0 — the case the old ratio gate declared "not a replacement".
    await seedCanonical("myntra", 100, "OLD");
    await seedSource("myntra", 100, "NEW");
    const s = await getReplacementSignals("myntra");
    expect(s.sourceCount / s.canonicalCount).toBe(1);
    expect(s.retention).toBe(0);
    expect(s.isReplacement).toBe(true);
    expect(s.reason).toBe("retention_below_threshold");
  });

  it("threshold is exclusive: retention exactly at the threshold is NOT a replacement", async () => {
    // 100 canonical, 5 retained → retention 0.05, equal to the threshold.
    await seedCanonical("myntra", 100, "A");
    await seedSource("myntra", 5, "A"); // first 5 identities match
    const s = await getReplacementSignals("myntra");
    expect(s.retention).toBeCloseTo(RETENTION_REPLACEMENT_THRESHOLD, 10);
    expect(s.isReplacement, "boundary is `< threshold`, so equality is not a replacement").toBe(false);
  });

  it("detection is idempotent — repeated calls agree", async () => {
    await seedCanonical("myntra", 100, "OLD");
    await seedSource("myntra", 100, "NEW");
    const a = await detectSourceReplacement("myntra");
    const b = await detectSourceReplacement("myntra");
    const c = await detectSourceReplacement("myntra");
    expect([a, b, c]).toEqual([true, true, true]);
  });

  it("PROPAGATES errors instead of silently reporting 'no replacement'", async () => {
    // A detector that returns false on error is indistinguishable from one that
    // looked and found nothing — that is how the schema mismatch became silent
    // data corruption. Force a failure and require it to surface.
    await appSequelize.query(`ALTER TABLE "${S}".myntra_reviews RENAME TO myntra_reviews_hidden`);
    try {
      await expect(getReplacementSignals("myntra")).rejects.toThrow();
    } finally {
      await appSequelize.query(`ALTER TABLE "${S}".myntra_reviews_hidden RENAME TO myntra_reviews`);
    }
  });

  for (const platform of ["myntra", "flipkart"] as const) {
    it(`is marketplace-agnostic — ${platform} detection uses its own identity columns`, async () => {
      await seedCanonical(platform, 80, "OLD");
      await seedSource(platform, 80, "NEW");
      const s = await getReplacementSignals(platform);
      expect(s.sourceCount).toBe(80);
      expect(s.canonicalCount).toBe(80);
      expect(s.retention).toBe(0);
      expect(s.isReplacement).toBe(true);
    });
  }
});

describe("sourceReplacement — cleanup", () => {
  beforeAll(snapshotTables);
  afterAll(restoreTables);
  beforeEach(truncateAll);

  it("deletes canonical reviews absent from source, keeps those present", async () => {
    await seedCanonical("myntra", 100, "GONE");
    await seedSource("myntra", 40, "KEPT");
    await seedCanonical("myntra", 40, "KEPT");

    const before = await one(
      `SELECT COUNT(*)::int n FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    );
    expect(before.n).toBe(140);

    const result = await appSequelize.transaction((t) => cleanupStaleSourceData("myntra", t));

    expect(result.staleReviewsDeleted).toBe(100);
    const after = await one(
      `SELECT COUNT(*)::int n FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    );
    expect(after.n).toBe(40);
  });

  it("handles batch deletion above the 1000-row batch size", async () => {
    await seedCanonical("myntra", 2500, "GONE");
    const result = await appSequelize.transaction((t) => cleanupStaleSourceData("myntra", t));
    expect(result.staleReviewsDeleted).toBe(2500);
    const after = await one(
      `SELECT COUNT(*)::int n FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    );
    expect(after.n).toBe(0);
  });

  it("deletes product_dimension rows left with no reviews", async () => {
    await seedCanonical("myntra", 50, "GONE");
    await appSequelize.query(
      `INSERT INTO "${S}".product_dimension
         (platform, source_product_id, first_review_date, last_review_date, total_review_count)
       VALUES ('myntra','100',DATE '2026-06-01',DATE '2026-06-01',1),
              ('myntra','999',DATE '2026-06-01',DATE '2026-06-01',1)`,
    );

    const result = await appSequelize.transaction((t) => cleanupStaleSourceData("myntra", t));
    expect(result.staleProductsDeleted).toBeGreaterThan(0);
    const left = await one(
      `SELECT COUNT(*)::int n FROM "${S}".product_dimension WHERE platform='myntra'`,
    );
    expect(left.n).toBe(0);
  });

  it("deletes product_daily_metrics with no matching (product, date)", async () => {
    await appSequelize.query(
      `INSERT INTO "${S}".product_daily_metrics
         (platform, source_product_id, review_date, review_count, rating_sum)
       VALUES ('myntra','100',DATE '2026-06-01',1,3)`,
    );
    const result = await appSequelize.transaction((t) => cleanupStaleSourceData("myntra", t));
    expect(result.staleMetricsDeleted).toBe(1);
  });

  it("returns the documented result shape", async () => {
    await seedCanonical("myntra", 10, "GONE");
    const result = await appSequelize.transaction((t) => cleanupStaleSourceData("myntra", t));
    expect(result).toHaveProperty("staleReviewsDeleted");
    expect(result).toHaveProperty("staleProductsDeleted");
    expect(result).toHaveProperty("staleMetricsDeleted");
    expect(Array.isArray(result.affectedProducts)).toBe(true);
  });

  it("leaves the OTHER marketplace untouched", async () => {
    await seedCanonical("myntra", 60, "GONE");
    await seedSource("flipkart", 30, "FK");
    await seedCanonical("flipkart", 30, "FK");

    await appSequelize.transaction((t) => cleanupStaleSourceData("myntra", t));

    const fk = await one(
      `SELECT COUNT(*)::int n FROM "${S}".normalized_reviews WHERE platform='flipkart'`,
    );
    expect(fk.n, "flipkart rows must survive a myntra cleanup").toBe(30);
  });

  it("flipkart cleanup uses pid (regression: it previously queried a non-existent product_id)", async () => {
    await seedCanonical("flipkart", 40, "GONE");
    await seedSource("flipkart", 15, "KEPT");
    await seedCanonical("flipkart", 15, "KEPT");

    // Previously threw `column fr.product_id does not exist`, rolling everything back.
    const result = await appSequelize.transaction((t) => cleanupStaleSourceData("flipkart", t));

    expect(result.staleReviewsDeleted).toBe(40);
    const left = await one(
      `SELECT COUNT(*)::int n FROM "${S}".normalized_reviews WHERE platform='flipkart'`,
    );
    expect(left.n).toBe(15);
  });
});
