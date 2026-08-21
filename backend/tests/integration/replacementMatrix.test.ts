/**
 * REPLACEMENT DETECTION + SYNCHRONIZATION MATRIX
 *
 * Runs against the REAL PostgreSQL test database (pri_test_appstore), whose
 * schema co-locates source and canonical tables exactly as production does.
 * No mocks, no SQLite, no second database.
 *
 * Proves the guarantee: after a successful ingestion cycle,
 *   current source data == normalized_reviews
 * with no ghost reviews, stale products, or stale metrics — for replacements
 * with fewer / same / more rows, while leaving normal incremental ingestion
 * and the other marketplace untouched.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { QueryTypes } from "sequelize";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runIngestion } from "../../src/modules/ingestion/runIngestion.js";
import {
  getReplacementSignals,
  RETENTION_REPLACEMENT_THRESHOLD,
} from "../../src/modules/ingestion/sourceReplacement.js";
import type { Platform } from "../../src/types/unifiedReview.js";

const S = config.appStore.schema;
const q = (sql: string, bind: unknown[] = []) =>
  appSequelize.query(sql, { type: QueryTypes.SELECT, bind });

/** Wipe canonical + derived state for a clean starting point. */
async function resetCanonical(): Promise<void> {
  await appSequelize.query(
    `TRUNCATE "${S}".review_sentiment, "${S}".review_theme, "${S}".identity_anomalies,
              "${S}".normalized_reviews, "${S}".product_dimension,
              "${S}".product_daily_metrics, "${S}".ingestion_watermarks CASCADE`,
  );
}

async function resetSource(platform: Platform): Promise<void> {
  const table = platform === "myntra" ? "myntra_reviews" : "flipkart_reviews";
  await appSequelize.query(`TRUNCATE "${S}".${table} RESTART IDENTITY CASCADE`);
}

/**
 * Seed `count` source rows across `products` products.
 *
 * `tag` becomes part of every review_id, so two seeds with different tags share
 * ZERO composite identities — that is what makes a seed a genuine "completely
 * different dataset" rather than merely a different row count.
 */
async function seedSource(
  platform: Platform,
  { count, products, tag, startId = 1 }: { count: number; products: number; tag: string; startId?: number },
): Promise<void> {
  if (platform === "myntra") {
    await appSequelize.query(
      `INSERT INTO "${S}".myntra_reviews
         (id, product_id, brand_name, review_id, rating, title, body, review_date, reviewed_at, author_name)
       SELECT
         $2 + g,
         1000 + (g % $3),
         'Brand-' || (g % $3),
         $4 || '-r' || g,
         1 + (g % 5),
         'title ' || g,
         'body ' || g,
         DATE '2026-06-01' + ((g % 30) || ' days')::interval,
         TIMESTAMPTZ '2026-06-01 00:00:00+00' + ((g % 30) || ' days')::interval,
         'author-' || g
       FROM generate_series(0, $1 - 1) AS g`,
      { bind: [count, startId, products, tag] },
    );
  } else {
    await appSequelize.query(
      `INSERT INTO "${S}".flipkart_reviews
         (id, pid, brand_name, review_id, rating, title, comment, review_date, author_name)
       SELECT
         $2 + g,
         'PID' || (1000 + (g % $3)),
         'Brand-' || (g % $3),
         $4 || '-r' || g,
         1 + (g % 5),
         'title ' || g,
         'comment ' || g,
         DATE '2026-06-01' + ((g % 30) || ' days')::interval,
         'author-' || g
       FROM generate_series(0, $1 - 1) AS g`,
      { bind: [count, startId, products, tag] },
    );
  }
  await appSequelize.query(
    `SELECT setval('"${S}".${platform === "myntra" ? "myntra_reviews" : "flipkart_reviews"}_id_seq',
       GREATEST((SELECT COALESCE(MAX(id),1) FROM "${S}".${platform === "myntra" ? "myntra_reviews" : "flipkart_reviews"}), 1))`,
  );
}

interface Consistency {
  sourceCount: number;
  canonicalCount: number;
  ghosts: number;
  missing: number;
  staleProducts: number;
  staleMetrics: number;
  watermark: number;
  sourceMaxId: number;
}

/** The acceptance measurement: does canonical exactly equal current source? */
async function checkConsistency(platform: Platform): Promise<Consistency> {
  const src = platform === "myntra" ? "myntra_reviews" : "flipkart_reviews";
  const pidCol = platform === "myntra" ? "product_id" : "pid";

  const [row] = (await q(
    `SELECT
       (SELECT COUNT(*) FROM "${S}".${src})                                   AS "sourceCount",
       (SELECT COALESCE(MAX(id),0) FROM "${S}".${src})                        AS "sourceMaxId",
       (SELECT COUNT(*) FROM "${S}".normalized_reviews WHERE platform=$1)     AS "canonicalCount",
       (SELECT COUNT(*) FROM "${S}".normalized_reviews nr WHERE nr.platform=$1
          AND NOT EXISTS (SELECT 1 FROM "${S}".${src} s
             WHERE s.review_id=nr.source_review_id AND s.${pidCol}::text=nr.source_product_id)) AS "ghosts",
       (SELECT COUNT(*) FROM "${S}".${src} s
          WHERE NOT EXISTS (SELECT 1 FROM "${S}".normalized_reviews nr WHERE nr.platform=$1
             AND nr.source_review_id=s.review_id AND nr.source_product_id=s.${pidCol}::text)) AS "missing",
       (SELECT COUNT(*) FROM "${S}".product_dimension pd WHERE pd.platform=$1
          AND NOT EXISTS (SELECT 1 FROM "${S}".normalized_reviews nr
             WHERE nr.platform=$1 AND nr.source_product_id=pd.source_product_id)) AS "staleProducts",
       (SELECT COUNT(*) FROM "${S}".product_daily_metrics m WHERE m.platform=$1
          AND NOT EXISTS (SELECT 1 FROM "${S}".normalized_reviews nr
             WHERE nr.platform=$1 AND nr.source_product_id=m.source_product_id
               AND nr.review_date=m.review_date)) AS "staleMetrics",
       (SELECT COALESCE(MAX(last_seen_source_id),0) FROM "${S}".ingestion_watermarks WHERE platform=$1) AS "watermark"`,
    [platform],
  )) as any[];

  return {
    sourceCount: Number(row.sourceCount),
    canonicalCount: Number(row.canonicalCount),
    ghosts: Number(row.ghosts),
    missing: Number(row.missing),
    staleProducts: Number(row.staleProducts),
    staleMetrics: Number(row.staleMetrics),
    watermark: Number(row.watermark),
    sourceMaxId: Number(row.sourceMaxId),
  };
}

function expectFullyConsistent(c: Consistency, expectedRows: number, label: string) {
  const detail = ` [${label}] ${JSON.stringify(c)}`;
  expect(c.sourceCount, "source count" + detail).toBe(expectedRows);
  expect(c.canonicalCount, "canonical count" + detail).toBe(expectedRows);
  expect(c.ghosts, "GHOST reviews must be 0" + detail).toBe(0);
  expect(c.missing, "MISSING reviews must be 0" + detail).toBe(0);
  expect(c.staleProducts, "stale product_dimension must be 0" + detail).toBe(0);
  expect(c.staleMetrics, "stale product_daily_metrics must be 0" + detail).toBe(0);
}

const T = 180_000; // real ingestion of 10-15k rows

describe("Source replacement matrix (real PostgreSQL)", () => {
  beforeAll(async () => {
    // Guard: never let this suite run against the live database.
    const [db] = (await q("SELECT current_database() AS db")) as any[];
    if (db.db !== "pri_test_appstore") {
      throw new Error(`REFUSING TO RUN: expected pri_test_appstore, got '${db.db}'`);
    }

    // This file needs total control of the source tables, but other suites in
    // the same run read the shared fixture dataset and do NOT seed their own.
    // Snapshot everything up front and put it back in afterAll, so running this
    // file leaves the database exactly as it was found rather than silently
    // breaking whichever file happens to execute next.
    for (const t of [
      "myntra_reviews", "flipkart_reviews", "normalized_reviews",
      "product_dimension", "product_daily_metrics", "ingestion_watermarks",
    ]) {
      await appSequelize.query(`DROP TABLE IF EXISTS "${S}".__snap_${t}`);
      await appSequelize.query(
        `CREATE TABLE "${S}".__snap_${t} AS TABLE "${S}".${t}`,
      );
    }
  });

  beforeEach(async () => {
    await resetCanonical();
    await resetSource("myntra");
    await resetSource("flipkart");
  });

  afterAll(async () => {
    // Restore the snapshot, then drop it.
    await resetCanonical();
    await resetSource("myntra");
    await resetSource("flipkart");
    for (const t of [
      "myntra_reviews", "flipkart_reviews", "normalized_reviews",
      "product_dimension", "product_daily_metrics", "ingestion_watermarks",
    ]) {
      await appSequelize.query(
        `INSERT INTO "${S}".${t} SELECT * FROM "${S}".__snap_${t}`,
      );
      await appSequelize.query(`DROP TABLE IF EXISTS "${S}".__snap_${t}`);
    }
    for (const t of ["myntra_reviews", "flipkart_reviews"]) {
      await appSequelize.query(
        `SELECT setval('"${S}".${t}_id_seq', GREATEST((SELECT COALESCE(MAX(id),1) FROM "${S}".${t}), 1))`,
      );
    }
  });

  // ── I. first-time ingestion ────────────────────────────────────────────────
  it("I. first-time ingestion: canonical empty is NOT a replacement", async () => {
    await seedSource("myntra", { count: 500, products: 25, tag: "A" });

    const signals = await getReplacementSignals("myntra");
    expect(signals.isReplacement).toBe(false);
    expect(signals.reason).toBe("canonical_empty_first_ingestion");

    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 500, "first-ingestion");
  }, T);

  // ── A. unchanged source + strict idempotency ───────────────────────────────
  it("A. unchanged source: second identical run is a no-op", async () => {
    await seedSource("myntra", { count: 500, products: 25, tag: "A" });
    await runTrackA("myntra");
    const first = await checkConsistency("myntra");

    const second = await runTrackA("myntra");
    const after = await checkConsistency("myntra");

    expect(second.rowsInserted, "second run must insert 0 rows").toBe(0);
    expect(after.canonicalCount).toBe(first.canonicalCount);
    expectFullyConsistent(after, 500, "idempotent-rerun");
  }, T);

  // ── B. normal incremental ──────────────────────────────────────────────────
  it("B. incremental +500: retention stays 1.0, originals preserved", async () => {
    await seedSource("myntra", { count: 10_000, products: 50, tag: "A" });
    await runTrackA("myntra");

    const originalIds = (await q(
      `SELECT source_review_id FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    )) as any[];
    expect(originalIds.length).toBe(10_000);

    // Append 500 genuinely new rows.
    await seedSource("myntra", { count: 500, products: 50, tag: "B", startId: 10_001 });

    const signals = await getReplacementSignals("myntra", undefined, { exact: true });
    expect(signals.retention, "every original identity still present").toBe(1);
    expect(signals.retainedCount).toBe(10_000);
    expect(signals.isReplacement, "adding rows must NOT be a replacement").toBe(false);

    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 10_500, "incremental");

    const survivors = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id LIKE 'A-%'`,
    )) as any[];
    expect(survivors[0].n, "all 10,000 originals must survive").toBe(10_000);
  }, T);

  // ── F. replacement with MORE rows — the live corruption case ───────────────
  it("F. REPLACEMENT 8,000 → 15,000 completely different (the regression)", async () => {
    await seedSource("myntra", { count: 8_000, products: 40, tag: "OLD" });
    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 8_000, "pre-replacement");

    // Wholesale swap: delete all source, insert 15,000 with zero shared identity.
    await resetSource("myntra");
    await seedSource("myntra", { count: 15_000, products: 60, tag: "NEW" });

    const signals = await getReplacementSignals("myntra");
    expect(signals.retention, "zero identity overlap").toBe(0);
    expect(
      signals.sourceCount / signals.canonicalCount,
      "count ratio alone looks like ordinary growth — this is why the old gate failed",
    ).toBeCloseTo(15_000 / 8_000, 4);
    expect(signals.isReplacement, "MUST be detected as replacement").toBe(true);

    await runTrackA("myntra");
    const after = await checkConsistency("myntra");
    expectFullyConsistent(after, 15_000, "post-replacement");

    const oldRows = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id LIKE 'OLD-%'`,
    )) as any[];
    expect(oldRows[0].n, "all 8,000 old rows must be gone").toBe(0);
    expect(after.watermark, "watermark must track the new source").toBe(after.sourceMaxId);
  }, T);

  // ── D. replacement with FEWER rows ─────────────────────────────────────────
  it("D. REPLACEMENT 15,000 → 8,000 completely different", async () => {
    await seedSource("myntra", { count: 15_000, products: 60, tag: "OLD" });
    await runTrackA("myntra");

    await resetSource("myntra");
    await seedSource("myntra", { count: 8_000, products: 40, tag: "NEW" });

    expect((await getReplacementSignals("myntra")).isReplacement).toBe(true);
    await runTrackA("myntra");

    expectFullyConsistent(await checkConsistency("myntra"), 8_000, "fewer-rows");
    const oldRows = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id LIKE 'OLD-%'`,
    )) as any[];
    expect(oldRows[0].n).toBe(0);
  }, T);

  // ── E. replacement with the SAME number of rows ────────────────────────────
  it("E. REPLACEMENT 10,000 → 10,000 completely different (ratio exactly 1.0)", async () => {
    await seedSource("myntra", { count: 10_000, products: 50, tag: "OLD" });
    await runTrackA("myntra");

    await resetSource("myntra");
    await seedSource("myntra", { count: 10_000, products: 50, tag: "NEW" });

    const signals = await getReplacementSignals("myntra");
    expect(signals.sourceCount / signals.canonicalCount, "ratio is exactly 1.0").toBe(1);
    expect(signals.retention).toBe(0);
    expect(signals.isReplacement, "identical counts must not mask a replacement").toBe(true);

    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 10_000, "same-size");
  }, T);

  // ── G. partial overlap ─────────────────────────────────────────────────────
  it("G. partial overlap 10,000 → 15,000 (10k retained) is NOT a replacement", async () => {
    await seedSource("myntra", { count: 10_000, products: 50, tag: "A" });
    await runTrackA("myntra");

    await seedSource("myntra", { count: 5_000, products: 50, tag: "B", startId: 10_001 });

    const signals = await getReplacementSignals("myntra", undefined, { exact: true });
    expect(signals.retention, "all 10k originals still present").toBe(1);
    expect(signals.retainedCount).toBe(10_000);
    expect(signals.isReplacement).toBe(false);

    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 15_000, "partial-overlap");
  }, T);

  // ── H. empty source guard ──────────────────────────────────────────────────
  it("H. empty source is NEVER a replacement (refuses to wipe canonical)", async () => {
    await seedSource("myntra", { count: 500, products: 25, tag: "A" });
    await runTrackA("myntra");

    await resetSource("myntra"); // source emptied — e.g. mid-reload or failed crawl

    const signals = await getReplacementSignals("myntra");
    expect(signals.isReplacement, "must refuse").toBe(false);
    expect(signals.reason).toBe("source_empty");

    await runTrackA("myntra");
    const after = await checkConsistency("myntra");
    expect(after.canonicalCount, "canonical must be preserved, not wiped").toBe(500);

    // Regression guard: deletion reconciliation must honour the SAME empty-source
    // rule. Against an empty source every canonical row looks stale, so an
    // unguarded cleanup deletes the entire dataset — which is exactly what this
    // assertion caught when the deletion path was first added.
    expect(after.canonicalCount, "deletion reconciliation must not wipe canonical either").toBe(500);
    const dim = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".product_dimension WHERE platform='myntra'`,
    )) as any[];
    expect(dim[0].n, "product_dimension must survive an empty source too").toBeGreaterThan(0);
  }, T);

  // ── threshold boundary ─────────────────────────────────────────────────────
  it("threshold: retention just BELOW 0.05 replaces, just ABOVE does not", async () => {
    // 1,000 canonical rows; keep exactly 40 (0.040) then exactly 60 (0.060).
    await seedSource("myntra", { count: 1_000, products: 20, tag: "A" });
    await runTrackA("myntra");

    // keep 40 → retention 0.040 < 0.05 → replacement
    await appSequelize.query(
      `DELETE FROM "${S}".myntra_reviews WHERE id > 40`,
    );
    await seedSource("myntra", { count: 900, products: 20, tag: "NEW", startId: 5_000 });
    let signals = await getReplacementSignals("myntra");
    expect(signals.retention).toBeCloseTo(0.04, 5);
    expect(signals.retention! < RETENTION_REPLACEMENT_THRESHOLD).toBe(true);
    expect(signals.isReplacement).toBe(true);

    // rebuild canonical at 1,000, then keep 60 → retention 0.060 > 0.05 → NOT replacement
    await resetCanonical();
    await resetSource("myntra");
    await seedSource("myntra", { count: 1_000, products: 20, tag: "A" });
    await runTrackA("myntra");
    await appSequelize.query(`DELETE FROM "${S}".myntra_reviews WHERE id > 60`);
    await seedSource("myntra", { count: 900, products: 20, tag: "NEW", startId: 5_000 });
    // exact: true — above the threshold the bounded scan stops early by design,
    // so only the exact mode can assert the true 0.06 retention value.
    signals = await getReplacementSignals("myntra", undefined, { exact: true });
    expect(signals.retention).toBeCloseTo(0.06, 5);
    expect(signals.retention! >= RETENTION_REPLACEMENT_THRESHOLD).toBe(true);
    expect(signals.isReplacement).toBe(false);

    // ...and the fast path must reach the identical verdict.
    expect((await getReplacementSignals("myntra")).isReplacement).toBe(false);
  }, T);

  // ── stranded watermark ─────────────────────────────────────────────────────
  it("stranded watermark above source MAX(id) is recovered by replacement", async () => {
    await seedSource("myntra", { count: 1_000, products: 20, tag: "OLD", startId: 50_000 });
    await runTrackA("myntra");
    const before = await checkConsistency("myntra");
    expect(before.watermark).toBe(50_999);

    // New source with LOWER ids — reproduces watermark 52,329 > MAX(id) 27,310.
    await resetSource("myntra");
    await seedSource("myntra", { count: 800, products: 20, tag: "NEW", startId: 1 });

    const stranded = await checkConsistency("myntra");
    expect(stranded.watermark, "watermark is stranded above source").toBeGreaterThan(stranded.sourceMaxId);

    await runTrackA("myntra");
    const after = await checkConsistency("myntra");
    expectFullyConsistent(after, 800, "stranded-watermark");
    expect(after.watermark, "watermark rewritten to current source MAX(id)").toBe(after.sourceMaxId);
  }, T);

  // ── marketplace isolation ──────────────────────────────────────────────────
  it("marketplace isolation: replacing Myntra leaves Flipkart byte-identical", async () => {
    await seedSource("myntra", { count: 2_000, products: 20, tag: "MOLD" });
    await seedSource("flipkart", { count: 2_000, products: 20, tag: "FKEEP" });
    await runTrackA("myntra");
    await runTrackA("flipkart");

    const fkBefore = await checkConsistency("flipkart");
    const [fkHashBefore] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='flipkart'`,
    )) as any[];

    // Replace Myntra only.
    await resetSource("myntra");
    await seedSource("myntra", { count: 3_500, products: 30, tag: "MNEW" });
    await runTrackA("myntra");

    expectFullyConsistent(await checkConsistency("myntra"), 3_500, "myntra-replaced");

    const fkAfter = await checkConsistency("flipkart");
    const [fkHashAfter] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='flipkart'`,
    )) as any[];

    expect(fkAfter.canonicalCount, "Flipkart row count unchanged").toBe(fkBefore.canonicalCount);
    expect(fkAfter.watermark, "Flipkart watermark unchanged").toBe(fkBefore.watermark);
    expect(fkHashAfter.h, "Flipkart content hash unchanged").toBe(fkHashBefore.h);
    expect(fkAfter.ghosts).toBe(0);
  }, T);

  // ── incremental deletions ──────────────────────────────────────────────────
  it("C. DELETIONS below the replacement threshold are still cleaned up", async () => {
    await seedSource("myntra", { count: 1_000, products: 20, tag: "A" });
    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 1_000, "pre-delete");

    // Remove 12 source rows — far too few to trip replacement detection.
    await appSequelize.query(
      `DELETE FROM "${S}".myntra_reviews WHERE id <= 12`,
    );

    const signals = await getReplacementSignals("myntra", undefined, { exact: true });
    expect(signals.retention, "retention stays ~0.99 — NOT a replacement").toBeGreaterThan(0.98);
    expect(signals.isReplacement, "must take the incremental path").toBe(false);

    await runTrackA("myntra");

    // The whole point: canonical must shed the 12 deleted rows anyway.
    expectFullyConsistent(await checkConsistency("myntra"), 988, "post-delete");
  }, T);

  it("C2. deleting a product's LAST review removes it from product_dimension", async () => {
    // 5 products × 20 reviews; wipe every review belonging to one product.
    await seedSource("myntra", { count: 100, products: 5, tag: "A" });
    await runTrackA("myntra");

    const dimBefore = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".product_dimension WHERE platform='myntra'`,
    )) as any[];
    expect(dimBefore[0].n).toBe(5);

    await appSequelize.query(
      `DELETE FROM "${S}".myntra_reviews WHERE product_id = 1000`,
    );
    await runTrackA("myntra");

    const dimAfter = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".product_dimension WHERE platform='myntra'`,
    )) as any[];
    expect(dimAfter[0].n, "the emptied product must be gone from product_dimension").toBe(4);

    const c = await checkConsistency("myntra");
    expect(c.ghosts).toBe(0);
    expect(c.staleProducts).toBe(0);
    expect(c.staleMetrics).toBe(0);
  }, T);

  it("C3. deletion reconciliation is a NO-OP when nothing was deleted", async () => {
    await seedSource("myntra", { count: 500, products: 10, tag: "A" });
    await runTrackA("myntra");

    // last_rebuilt_at is the idempotency canary: a clean run must not touch it.
    const before = (await q(
      `SELECT COUNT(*)::int AS n, MAX(last_rebuilt_at)::text AS ts
         FROM "${S}".product_dimension WHERE platform='myntra'`,
    )) as any[];

    await new Promise((r) => setTimeout(r, 1100)); // ensure a change would be visible
    const second = await runTrackA("myntra");

    const after = (await q(
      `SELECT COUNT(*)::int AS n, MAX(last_rebuilt_at)::text AS ts
         FROM "${S}".product_dimension WHERE platform='myntra'`,
    )) as any[];

    expect(second.rowsInserted, "no rows inserted on a clean rerun").toBe(0);
    expect(after[0].n).toBe(before[0].n);
    expect(after[0].ts, "last_rebuilt_at must NOT churn on a clean run").toBe(before[0].ts);
    expectFullyConsistent(await checkConsistency("myntra"), 500, "noop-rerun");
  }, T);

  it("C4. deletions in ONE marketplace never disturb the other", async () => {
    await seedSource("myntra", { count: 600, products: 12, tag: "M" });
    await seedSource("flipkart", { count: 600, products: 12, tag: "F" });
    await runTrackA("myntra");
    await runTrackA("flipkart");

    const [fkHashBefore] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='flipkart'`,
    )) as any[];

    await appSequelize.query(`DELETE FROM "${S}".myntra_reviews WHERE id <= 25`);
    await runTrackA("myntra");

    expectFullyConsistent(await checkConsistency("myntra"), 575, "myntra-after-delete");

    const [fkHashAfter] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='flipkart'`,
    )) as any[];
    expect(fkHashAfter.h, "flipkart canonical must be byte-identical").toBe(fkHashBefore.h);
    expectFullyConsistent(await checkConsistency("flipkart"), 600, "flipkart-untouched");
  }, T);

  // ── watermark-ahead backfill ───────────────────────────────────────────────
  it("W. rows written BELOW a watermark that ran ahead are still ingested", async () => {
    await seedSource("myntra", { count: 200, products: 10, tag: "A", startId: 1 });
    await runTrackA("myntra");
    expectFullyConsistent(await checkConsistency("myntra"), 200, "pre-backfill");

    // Push the watermark far past the source, as a sequence that has run ahead
    // (or a source reload) leaves it.
    await appSequelize.query(
      `UPDATE "${S}".ingestion_watermarks SET last_seen_source_id = 90000 WHERE platform='myntra'`,
    );
    const stranded = await checkConsistency("myntra");
    expect(stranded.watermark).toBeGreaterThan(stranded.sourceMaxId);

    // A historical backfill preserving upstream ids — every row BELOW the watermark.
    await seedSource("myntra", { count: 50, products: 10, tag: "HIST", startId: 500 });

    // Not a replacement: the 200 originals are all still present.
    const signals = await getReplacementSignals("myntra", undefined, { exact: true });
    expect(signals.isReplacement, "a backfill is not a replacement").toBe(false);

    await runTrackA("myntra");

    // Without the watermark-ahead guard these 50 rows are unreachable forever.
    expectFullyConsistent(await checkConsistency("myntra"), 250, "post-backfill");
    const hist = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id LIKE 'HIST-%'`,
    )) as any[];
    expect(hist[0].n, "all 50 below-watermark rows must be ingested").toBe(50);

    // …and the watermark must be repaired so the next run is incremental again.
    const after = await checkConsistency("myntra");
    expect(after.watermark, "watermark rebuilt from real data").toBe(after.sourceMaxId);
  }, T);

  // ── full-scan reconciliation ───────────────────────────────────────────────
  it("U. an edit to a review OLDER than the reconciliation window propagates", async () => {
    await seedSource("myntra", { count: 100, products: 5, tag: "A" });
    // Backdate one review far outside the 60+10 day window.
    await appSequelize.query(
      `UPDATE "${S}".myntra_reviews
          SET review_date = CURRENT_DATE - 400,
              reviewed_at = now() - interval '400 days'
        WHERE id = 1`,
    );
    await runIngestion("myntra");

    const before = (await q(
      `SELECT rating FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id='A-r0'`,
    )) as any[];
    expect(before[0].rating).toBeDefined();

    // Edit it. Track A will not revisit it (its id is below the watermark), so
    // only a full-table Track B reconciliation can carry the change through.
    await appSequelize.query(
      `UPDATE "${S}".myntra_reviews SET rating = 1, "updatedAt" = now() WHERE id = 1`,
    );
    await runIngestion("myntra");

    const after = (await q(
      `SELECT rating FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id='A-r0'`,
    )) as any[];
    expect(Number(after[0].rating), "old-review edits must reach canonical").toBe(1);
  }, T);

  // ── atomic rollback ────────────────────────────────────────────────────────
  it("ROLLBACK: a failed replacement leaves the previous dataset fully intact", async () => {
    await seedSource("myntra", { count: 1_000, products: 20, tag: "OLD" });
    await runTrackA("myntra");

    const before = await checkConsistency("myntra");
    const [hashBefore] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    )) as any[];
    expectFullyConsistent(before, 1_000, "pre-rollback");

    // Replacement whose row set cannot fully materialise: one row carries an
    // invalid rating, so it is rejected during validation. Canonical would end
    // up 1 short of source, the pre-commit consistency check fires, and the
    // ENTIRE replacement must roll back — not land half-applied.
    await resetSource("myntra");
    await seedSource("myntra", { count: 2_000, products: 25, tag: "NEW" });
    await appSequelize.query(
      `UPDATE "${S}".myntra_reviews SET rating = 9 WHERE id = 1`,
    );

    await expect(runTrackA("myntra")).rejects.toThrow(/consistency check FAILED/i);

    // Canonical must be byte-identical to its pre-attempt state.
    const after = await checkConsistency("myntra");
    const [hashAfter] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    )) as any[];

    expect(after.canonicalCount, "old dataset must be fully preserved").toBe(1_000);
    expect(hashAfter.h, "canonical content must be unchanged").toBe(hashBefore.h);
    expect(after.watermark, "watermark must NOT advance on a failed run").toBe(before.watermark);

    const newRows = (await q(
      `SELECT COUNT(*)::int AS n FROM "${S}".normalized_reviews
        WHERE platform='myntra' AND source_review_id LIKE 'NEW-%'`,
    )) as any[];
    expect(newRows[0].n, "no partial rows from the failed replacement").toBe(0);
  }, T);

  // ── reverse isolation ──────────────────────────────────────────────────────
  it("marketplace isolation (reverse): replacing Flipkart leaves Myntra untouched", async () => {
    await seedSource("myntra", { count: 2_000, products: 20, tag: "MKEEP" });
    await seedSource("flipkart", { count: 2_000, products: 20, tag: "FOLD" });
    await runTrackA("myntra");
    await runTrackA("flipkart");

    const myBefore = await checkConsistency("myntra");
    const [myHashBefore] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    )) as any[];

    await resetSource("flipkart");
    await seedSource("flipkart", { count: 3_500, products: 30, tag: "FNEW" });
    await runTrackA("flipkart");

    expectFullyConsistent(await checkConsistency("flipkart"), 3_500, "flipkart-replaced");

    const myAfter = await checkConsistency("myntra");
    const [myHashAfter] = (await q(
      `SELECT md5(string_agg(canonical_review_id, ',' ORDER BY canonical_review_id)) AS h
         FROM "${S}".normalized_reviews WHERE platform='myntra'`,
    )) as any[];

    expect(myAfter.canonicalCount).toBe(myBefore.canonicalCount);
    expect(myAfter.watermark).toBe(myBefore.watermark);
    expect(myHashAfter.h).toBe(myHashBefore.h);
  }, T);
});
