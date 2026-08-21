/**
 * Source data replacement detection and cleanup.
 *
 * Marketplace-agnostic mechanism for handling complete source dataset
 * replacements. Adding a marketplace means adding ONE entry to SOURCE_TABLES —
 * no query in this file branches on platform.
 */

import { QueryTypes, Transaction } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { logger } from "../../shared/logger.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { AffectedProduct } from "../analytics/synchronize.js";

export interface ReplacementCleanupResult {
  staleReviewsDeleted: number;
  staleProductsDeleted: number;
  staleMetricsDeleted: number;
  /**
   * Products the cleanup touched that STILL have reviews. Safe to hand to the
   * analytics synchronizers, which would otherwise recreate a dimension row for
   * a product that no longer has any.
   */
  affectedProducts: AffectedProduct[];
  /**
   * Products whose LAST review was deleted — now gone from product_dimension.
   *
   * Tracked separately because they must still be ANNOUNCED. They cannot be
   * synchronized (there is nothing left to rebuild), but a client showing them
   * has to learn they disappeared; without this the row stays on screen until a
   * manual refresh, which is exactly the stale-UI symptom this work set out to
   * eliminate.
   */
  removedProducts: AffectedProduct[];
}

export interface ReplacementSignals {
  sourceCount: number;
  sourceMaxId: number;
  canonicalCount: number;
  /**
   * Canonical rows whose (product, review_id) still exists in source.
   * When `retentionExact` is false this is a LOWER BOUND — counting stopped
   * early because the answer was already determined (see getReplacementSignals).
   */
  retainedCount: number;
  /** retainedCount / canonicalCount — null when canonical is empty. A lower bound when `retentionExact` is false. */
  retention: number | null;
  /** true when retainedCount/retention are exact rather than an early-exit lower bound */
  retentionExact: boolean;
  isReplacement: boolean;
  reason: string;
}

/**
 * Replacement threshold, as a fraction of canonical rows still present in source.
 *
 * Below this, the source has turned over so completely that the canonical copy
 * must be rebuilt from the current source rather than incrementally reconciled.
 *
 * Deliberately biased toward the RECOVERABLE error. A false positive triggers a
 * full resync — more expensive, but idempotent and converging on the identical
 * correct end state. A false negative leaves ghost rows in canonical forever,
 * which is the failure that corrupted the live Myntra dataset (retention 0.0000
 * misread as incremental because count_ratio 1.28 looked unremarkable).
 *
 * 0.05 rather than exactly 0 so a near-total purge that happens to reuse a
 * handful of review ids still resyncs instead of silently half-applying.
 */
export const RETENTION_REPLACEMENT_THRESHOLD = 0.05;

/**
 * The ONLY two source tables that exist, and the columns that form each one's
 * review identity.
 *
 * Identity is the COMPOSITE (product, review) pair, never bare review_id: both
 * source tables enforce UNIQUE (product, review_id), normalized_reviews enforces
 * UNIQUE (platform, source_product_id, source_review_id), and Flipkart's
 * review_id is a synthetic, collision-prone hash that is not unique on its own.
 *
 * NOTE the column names differ per marketplace — myntra uses product_id, flipkart
 * uses pid. A previous version of this file hardcoded `product_id` for BOTH,
 * so every Flipkart cleanup threw `column fr.product_id does not exist` and rolled
 * the transaction back. Encoding it here once removes that whole class of bug.
 */
const SOURCE_TABLES: Record<Platform, { table: string; productIdColumn: string; reviewIdColumn: string }> = {
  flipkart: { table: "flipkart_reviews", productIdColumn: "pid", reviewIdColumn: "review_id" },
  myntra: { table: "myntra_reviews", productIdColumn: "product_id", reviewIdColumn: "review_id" },
};

/**
 * Single schema-resolution strategy for the whole ingestion system: whatever
 * schema the application's own connection uses (config.appStore.schema).
 *
 * Never a hardcoded "DataWarehouse". Source and canonical tables are co-located
 * and reached through one connection (appSequelize), so a literal here would
 * silently disagree with the repositories — which resolve the schema from config —
 * in every environment whose DB_SCHEMA is not literally "DataWarehouse".
 */
function sourceRef(platform: Platform): { ref: string; productIdColumn: string; reviewIdColumn: string } {
  const spec = SOURCE_TABLES[platform];
  if (!spec) throw new Error(`No source table registered for platform '${platform}'`);
  return {
    ref: `"${config.appStore.schema}".${spec.table}`,
    productIdColumn: spec.productIdColumn,
    reviewIdColumn: spec.reviewIdColumn,
  };
}

function canonicalRef(): string {
  return `"${config.appStore.schema}".normalized_reviews`;
}

/**
 * Gather every signal replacement detection depends on, in ONE pass, so the
 * numbers are mutually consistent and can be logged as evidence.
 */
export async function getReplacementSignals(
  platform: Platform,
  transaction?: Transaction,
  options: { exact?: boolean } = {},
): Promise<ReplacementSignals> {
  const { ref, productIdColumn, reviewIdColumn } = sourceRef(platform);
  const canonical = canonicalRef();

  // Step 1 — cheap counts only. All three are index-only scans, and on the two
  // guard paths below they are the ONLY work done: no join is issued at all.
  const [counts] = await appSequelize.query<{
    sourceCount: string;
    sourceMaxId: string;
    canonicalCount: string;
  }>(
    `SELECT
       (SELECT COUNT(*)             FROM ${ref})                             AS "sourceCount",
       (SELECT COALESCE(MAX(id), 0) FROM ${ref})                             AS "sourceMaxId",
       (SELECT COUNT(*)             FROM ${canonical} WHERE platform = $1)   AS "canonicalCount"`,
    { type: QueryTypes.SELECT, bind: [platform], transaction },
  );

  const sourceCount = Number(counts?.sourceCount ?? 0);
  const sourceMaxId = Number(counts?.sourceMaxId ?? 0);
  const canonicalCount = Number(counts?.canonicalCount ?? 0);

  // Guard 1 — empty source is NEVER a replacement. A source mid-reload, or a
  // failed crawl, would otherwise wipe the entire canonical dataset. Refusing
  // here costs one stale cycle; acting would cost the dataset.
  if (sourceCount === 0) {
    return {
      sourceCount, sourceMaxId, canonicalCount,
      retainedCount: 0, retention: canonicalCount === 0 ? null : 0, retentionExact: true,
      isReplacement: false, reason: "source_empty",
    };
  }

  // Guard 2 — nothing to replace on first-time ingestion.
  if (canonicalCount === 0) {
    return {
      sourceCount, sourceMaxId, canonicalCount,
      retainedCount: 0, retention: null, retentionExact: true,
      isReplacement: false, reason: "canonical_empty_first_ingestion",
    };
  }

  /**
   * Step 2 — retention, with a bounded scan.
   *
   * The verdict only depends on whether retention crosses the threshold, so
   * counting every retained row is wasted work in the overwhelmingly common
   * case (incremental ingestion, retention ≈ 1). Stopping as soon as
   *     retained > floor(threshold × canonicalCount)
   * settles the question: any further match cannot bring retention back below
   * the threshold.
   *
   * Cost profile — the fast path is the common one:
   *   incremental (retention ≈ 1) → stops after ~5% of canonical rows
   *   replacement (retention ≈ 0) → scans fully, but only on the rare run that
   *                                 is about to do a full resync anyway
   *
   * Semantics are unchanged: when the cap is NOT reached the count is exact, and
   * when it IS reached retention is provably ≥ threshold. Pass { exact: true }
   * to force a full count for observability/audit; the verdict is identical
   * either way, which sourceReplacement.test.ts asserts directly.
   */
  const cap = Math.floor(RETENTION_REPLACEMENT_THRESHOLD * canonicalCount) + 1;

  const retainedSql = `
    SELECT COUNT(*)::int AS "retainedCount" FROM (
      SELECT 1
        FROM ${canonical} nr
       WHERE nr.platform = $1
         AND EXISTS (
           SELECT 1 FROM ${ref} s
            WHERE s.${reviewIdColumn} = nr.source_review_id
              AND s.${productIdColumn}::text = nr.source_product_id
         )
       ${options.exact ? "" : "LIMIT " + cap}
    ) t`;

  const [retainedRow] = await appSequelize.query<{ retainedCount: number }>(retainedSql, {
    type: QueryTypes.SELECT,
    bind: [platform],
    transaction,
  });

  const retainedCount = Number(retainedRow?.retainedCount ?? 0);
  const capped = !options.exact && retainedCount >= cap;
  const retention = retainedCount / canonicalCount;

  // capped ⇒ retention ≥ threshold ⇒ not a replacement.
  const isReplacement = !capped && retention < RETENTION_REPLACEMENT_THRESHOLD;

  return {
    sourceCount, sourceMaxId, canonicalCount, retainedCount, retention,
    retentionExact: !capped,
    isReplacement,
    reason: isReplacement ? "retention_below_threshold" : "retention_normal_incremental",
  };
}

/**
 * Detect genuine source data replacement.
 *
 * PRIMARY SIGNAL: retention — the fraction of canonical rows whose composite
 * identity still exists in the current source.
 *
 *   retention ≈ 1  →  incremental (unchanged, additions, in-place updates)
 *   retention ≈ 0  →  replacement (source dataset swapped wholesale)
 *
 * Row COUNT RATIO is explicitly NOT used. Replacement is a statement about
 * identity turnover, which a count ratio cannot observe: the live Myntra
 * failure had zero overlap yet a count_ratio of 1.28, indistinguishable from
 * ordinary growth. Retention separated the same two cases as 0.00 vs 1.00.
 *
 * Handles uniformly: fewer rows, same rows, more rows, partial overlap, empty
 * source, and first-time ingestion.
 *
 * THROWS on error rather than returning false. A detector that swallows errors
 * reports "not a replacement" when it actually failed to look — which is how a
 * schema mismatch silently became permanent data corruption.
 */
export async function detectSourceReplacement(
  platform: Platform,
  transaction?: Transaction,
): Promise<boolean> {
  const signals = await getReplacementSignals(platform, transaction);

  logger.info(
    {
      platform,
      sourceCount: signals.sourceCount,
      sourceMaxId: signals.sourceMaxId,
      canonicalCount: signals.canonicalCount,
      retainedCount: signals.retainedCount,
      retention: signals.retention === null ? null : Number(signals.retention.toFixed(4)),
      retentionExact: signals.retentionExact,
      threshold: RETENTION_REPLACEMENT_THRESHOLD,
      isReplacement: signals.isReplacement,
      reason: signals.reason,
    },
    signals.isReplacement
      ? "Source replacement DETECTED"
      : "No source replacement — normal incremental path",
  );

  return signals.isReplacement;
}

/**
 * Cheap existence probe: does canonical hold ANY row whose source row is gone?
 *
 * Deliberately bounded (LIMIT 1) so the answer costs almost nothing on the
 * overwhelmingly common clean run. This is what makes it affordable to check for
 * deletions on EVERY ingestion run rather than only during a replacement — the
 * gap that let a handful of deleted source rows linger in canonical forever,
 * because retention stays ~0.999 and the incremental path never looked.
 */
export async function hasStaleCanonicalRows(
  platform: Platform,
  transaction?: Transaction,
): Promise<boolean> {
  const { ref, productIdColumn, reviewIdColumn } = sourceRef(platform);
  const [row] = await appSequelize.query<{ stale: number }>(
    `SELECT COUNT(*)::int AS stale FROM (
       SELECT 1 FROM ${canonicalRef()} nr
        WHERE nr.platform = $1
          AND NOT EXISTS (
            SELECT 1 FROM ${ref} s
             WHERE s.${productIdColumn}::text = nr.source_product_id
               AND s.${reviewIdColumn} = nr.source_review_id
          )
        LIMIT 1
     ) t`,
    { type: QueryTypes.SELECT, bind: [platform], transaction },
  );
  return Number(row?.stale ?? 0) > 0;
}

/** Every product that currently has at least one canonical review. */
export async function listProductsWithReviews(
  platform: Platform,
  transaction?: Transaction,
): Promise<AffectedProduct[]> {
  const rows = await appSequelize.query<{ platform: string; sourceProductId: string }>(
    `SELECT DISTINCT platform, source_product_id AS "sourceProductId"
       FROM ${canonicalRef()} WHERE platform = $1`,
    { type: QueryTypes.SELECT, bind: [platform], transaction },
  );
  return (rows || []).map((r) => ({
    platform: r.platform as Platform,
    sourceProductId: r.sourceProductId,
  }));
}

/**
 * Clean up stale source data for any platform.
 *
 * Marketplace-agnostic cleanup of:
 * - normalized_reviews rows whose composite identity is gone from source
 * - product_dimension rows for products left with no reviews
 * - product_daily_metrics rows for (product, date) pairs left with no reviews
 *
 * `affectedProducts` lists ONLY the products this cleanup actually touched, not
 * every product on the platform. That precision is what allows the caller to
 * re-synchronize analytics for the handful of changed products instead of
 * rebuilding the whole catalogue — which would rewrite last_rebuilt_at on every
 * run and destroy idempotency. A caller that genuinely needs the full set (the
 * replacement path, where every product is new) calls listProductsWithReviews().
 *
 * Caller supplies the transaction; every failure propagates so the caller rolls back.
 */
export async function cleanupStaleSourceData(
  platform: Platform,
  transaction: Transaction,
): Promise<ReplacementCleanupResult> {
  const schema = config.appStore.schema;
  const { ref, productIdColumn, reviewIdColumn } = sourceRef(platform);

  let staleReviewsDeleted = 0;
  let staleProductsDeleted = 0;
  let staleMetricsDeleted = 0;
  const affectedProducts: AffectedProduct[] = [];
  const removedProducts: AffectedProduct[] = [];

  try {
    // Phase 1 — canonical reviews no longer present in source, by COMPOSITE identity.
    const staleReviews = await appSequelize.query<{
      canonicalReviewId: string;
      sourceProductId: string;
    }>(
      `SELECT nr.canonical_review_id AS "canonicalReviewId",
              nr.source_product_id   AS "sourceProductId"
         FROM "${schema}".normalized_reviews nr
        WHERE nr.platform = $1
          AND NOT EXISTS (
            SELECT 1 FROM ${ref} s
             WHERE s.${productIdColumn}::text = nr.source_product_id
               AND s.${reviewIdColumn} = nr.source_review_id
          )`,
      { type: QueryTypes.SELECT, bind: [platform], transaction },
    );

    const staleReviewIds = (staleReviews || []).map((r) => r.canonicalReviewId);

    // Products touched by this cleanup — the precise set, collected as we go.
    const touched = new Map<string, AffectedProduct>();
    for (const r of staleReviews || []) {
      touched.set(`${platform}:${r.sourceProductId}`, {
        platform,
        sourceProductId: r.sourceProductId,
      });
    }

    if (staleReviewIds.length > 0) {
      // Batched, and dependants first — review_sentiment / review_theme /
      // identity_anomalies all FK to normalized_reviews.
      const batchSize = 1000;
      for (let i = 0; i < staleReviewIds.length; i += batchSize) {
        const batch = staleReviewIds.slice(i, i + batchSize);
        for (const dependant of ["identity_anomalies", "review_sentiment", "review_theme"]) {
          await appSequelize.query(
            `DELETE FROM "${schema}".${dependant} WHERE canonical_review_id = ANY($1)`,
            { bind: [batch], transaction },
          );
        }
        await appSequelize.query(
          `DELETE FROM "${schema}".normalized_reviews WHERE canonical_review_id = ANY($1)`,
          { bind: [batch], transaction },
        );
      }

      staleReviewsDeleted = staleReviewIds.length;
      logger.info({ platform, count: staleReviewsDeleted }, "Deleted stale normalized_reviews");
    }

    // Phase 2 — product_dimension rows with no surviving reviews.
    const staleProducts = await appSequelize.query<{ sourceProductId: string }>(
      `SELECT DISTINCT pd.source_product_id AS "sourceProductId"
         FROM "${schema}".product_dimension pd
        WHERE pd.platform = $1
          AND NOT EXISTS (
            SELECT 1 FROM "${schema}".normalized_reviews nr
             WHERE nr.platform = $1
               AND nr.source_product_id = pd.source_product_id
          )`,
      { type: QueryTypes.SELECT, bind: [platform], transaction },
    );

    const staleProductIds = (staleProducts || []).map((p) => p.sourceProductId);

    if (staleProductIds.length > 0) {
      await appSequelize.query(
        `DELETE FROM "${schema}".product_dimension
          WHERE platform = $1 AND source_product_id = ANY($2)`,
        { bind: [platform, staleProductIds], transaction },
      );
      staleProductsDeleted = staleProductIds.length;
      logger.info({ platform, count: staleProductsDeleted }, "Deleted stale product_dimension");
    }

    // Phase 3 — product_daily_metrics rows with no surviving (product, date).
    // Single DELETE ... RETURNING so the count reflects what was actually removed,
    // rather than a COUNT taken before a separate DELETE.
    const deletedMetrics = await appSequelize.query<{ source_product_id: string }>(
      `DELETE FROM "${schema}".product_daily_metrics pdm
        WHERE pdm.platform = $1
          AND NOT EXISTS (
            SELECT 1 FROM "${schema}".normalized_reviews nr
             WHERE nr.platform = $1
               AND nr.source_product_id = pdm.source_product_id
               AND nr.review_date = pdm.review_date
          )
        RETURNING pdm.source_product_id`,
      { type: QueryTypes.SELECT, bind: [platform], transaction },
    );

    staleMetricsDeleted = (deletedMetrics || []).length;
    if (staleMetricsDeleted > 0) {
      logger.info({ platform, count: staleMetricsDeleted }, "Deleted stale product_daily_metrics");
    }
    for (const m of deletedMetrics || []) {
      touched.set(`${platform}:${m.source_product_id}`, {
        platform,
        sourceProductId: m.source_product_id,
      });
    }

    // Only products that still HAVE reviews can be re-synchronized; a product
    // whose last review was deleted had its dimension row removed above and must
    // not be handed to the synchronizers, which would recreate it.
    const survivors = await appSequelize.query<{ sourceProductId: string }>(
      `SELECT DISTINCT source_product_id AS "sourceProductId"
         FROM "${schema}".normalized_reviews
        WHERE platform = $1 AND source_product_id = ANY($2)`,
      {
        type: QueryTypes.SELECT,
        bind: [platform, [...touched.values()].map((p) => p.sourceProductId)],
        transaction,
      },
    );
    const survivorIds = new Set((survivors || []).map((s) => s.sourceProductId));
    for (const p of touched.values()) {
      if (survivorIds.has(p.sourceProductId)) affectedProducts.push(p);
      else removedProducts.push(p);
    }

    logger.info(
      {
        platform,
        staleReviewsDeleted,
        staleProductsDeleted,
        staleMetricsDeleted,
        affectedProducts: affectedProducts.length,
        removedProducts: removedProducts.length,
      },
      "Source replacement cleanup complete",
    );

    return { staleReviewsDeleted, staleProductsDeleted, staleMetricsDeleted, affectedProducts, removedProducts };
  } catch (err) {
    logger.error(
      {
        platform,
        error: (err as Error).message,
        staleReviewsDeleted,
        staleProductsDeleted,
        staleMetricsDeleted,
      },
      "Error during replacement cleanup",
    );
    throw err; // Let the caller's transaction roll back.
  }
}
