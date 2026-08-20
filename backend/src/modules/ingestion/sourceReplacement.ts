/**
 * Source data replacement detection and cleanup
 * Marketplace-agnostic mechanism for handling complete source dataset replacements
 * Supports any marketplace (Myntra, Flipkart, future platforms)
 */

import { QueryTypes, Transaction } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import * as prodReadOnly from "../../database/prodReadOnly/index.js";
import { config } from "../../config/index.js";
import { logger } from "../../shared/logger.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { AffectedProduct } from "../analytics/synchronize.js";

export interface ReplacementCleanupResult {
  staleReviewsDeleted: number;
  staleProductsDeleted: number;
  staleMetricsDeleted: number;
  affectedProducts: AffectedProduct[];
}

/**
 * Get source review count for a platform
 * Works with any marketplace via prodReadOnly abstraction
 */
async function getSourceReviewCount(
  platform: Platform,
  transaction?: Transaction,
): Promise<{ count: number; maxId: number }> {
  if (platform === "flipkart") {
    const result = await appSequelize.query<{ count: number; maxId: number }>(
      `SELECT COUNT(*) as count, COALESCE(MAX(id), 0) as "maxId"
       FROM "DataWarehouse".flipkart_reviews`,
      { type: QueryTypes.SELECT, plain: true, transaction },
    );
    return (result as any) || { count: 0, maxId: 0 };
  } else if (platform === "myntra") {
    const result = await appSequelize.query<{ count: number; maxId: number }>(
      `SELECT COUNT(*) as count, COALESCE(MAX(id), 0) as "maxId"
       FROM "DataWarehouse".myntra_reviews`,
      { type: QueryTypes.SELECT, plain: true, transaction },
    );
    return (result as any) || { count: 0, maxId: 0 };
  }
  return { count: 0, maxId: 0 };
}

/**
 * Detect genuine source data replacement
 * Primary signal: review_id content overlap (not ID ranges)
 * Works for: fewer rows, same rows, or more rows than canonical
 * Conservative: requires both content difference AND count difference
 * Platform-agnostic for any marketplace
 */
export async function detectSourceReplacement(
  platform: Platform,
  transaction?: Transaction,
): Promise<boolean> {
  const schema = config.appStore.schema;

  try {
    // Get exact source counts
    const { count: sourceCount, maxId: sourceMaxId } = await getSourceReviewCount(
      platform,
      transaction,
    );

    // Get exact canonical counts
    const canonicalResult = await appSequelize.query<{
      count: number;
      maxSourceRowId: number;
    }>(
      `SELECT COUNT(*) as count, COALESCE(MAX(source_row_id), 0) as "maxSourceRowId"
       FROM "${schema}".normalized_reviews
       WHERE platform = $1`,
      { type: QueryTypes.SELECT, plain: true, bind: [platform], transaction },
    );

    const canonicalCount = Number((canonicalResult as any)?.count || 0);
    const canonicalMaxSourceRowId = Number((canonicalResult as any)?.maxSourceRowId || 0);

    logger.debug(
      {
        platform,
        sourceCount,
        sourceMaxId,
        canonicalCount,
        canonicalMaxSourceRowId,
      },
      "Replacement detection data",
    );

    // Decision tree - PRIMARY SIGNAL: review_id content overlap

    // 1. Source is empty → not a replacement (might be startup or error)
    if (sourceCount === 0) {
      logger.debug({ platform, sourceCount }, "Source is empty, not a replacement");
      return false;
    }

    // 2. Canonical is empty → not a replacement (startup condition)
    if (canonicalCount === 0) {
      logger.debug({ platform, canonicalCount }, "Canonical is empty, not a replacement");
      return false;
    }

    // 3. CHECK REVIEW_ID OVERLAP (primary detection signal)
    // This is the KEY SIGNAL that works for ALL scenarios:
    // - Fewer rows replacement
    // - Same rows replacement
    // - More rows replacement
    // - Normal incremental
    let reviewIdOverlapQuery = "";
    if (platform === "flipkart") {
      reviewIdOverlapQuery = `SELECT COUNT(*) as "overlapCount"
       FROM "DataWarehouse".flipkart_reviews fr
       WHERE EXISTS (
         SELECT 1 FROM "${schema}".normalized_reviews nr
         WHERE nr.platform = $1
           AND nr.source_review_id = fr.review_id
       )`;
    } else if (platform === "myntra") {
      reviewIdOverlapQuery = `SELECT COUNT(*) as "overlapCount"
       FROM "DataWarehouse".myntra_reviews mr
       WHERE EXISTS (
         SELECT 1 FROM "${schema}".normalized_reviews nr
         WHERE nr.platform = $1
           AND nr.source_review_id = mr.review_id
       )`;
    }

    const reviewIdOverlapResult = await appSequelize.query<{ overlapCount: number }>(
      reviewIdOverlapQuery,
      {
        type: QueryTypes.SELECT,
        plain: true,
        bind: [platform],
        transaction,
      },
    );

    const reviewIdOverlapCount = Number((reviewIdOverlapResult as any)?.overlapCount || 0);

    logger.debug(
      {
        platform,
        sourceCount,
        canonicalCount,
        reviewIdOverlapCount,
      },
      "Review ID overlap check in replacement detection",
    );

    // 4. If review_ids DON'T overlap (content is completely different)
    //    AND counts are significantly different → REPLACEMENT
    if (reviewIdOverlapCount === 0) {
      // Source and canonical have zero review_id overlap
      // This means the datasets are completely different
      // But conservative: only act if count difference is significant
      const countRatio = sourceCount / canonicalCount;

      // Replacement threshold: source is < 50% OR > 150% of canonical
      // This handles: fewer rows, same rows, more rows scenarios
      if (countRatio < 0.5 || countRatio > 1.5) {
        logger.info(
          {
            platform,
            sourceCount,
            sourceMaxId,
            canonicalCount,
            canonicalMaxSourceRowId,
            reviewIdOverlapCount,
            countRatio: countRatio.toFixed(2),
          },
          "Source replacement DETECTED (review_id overlap = 0, count ratio extreme)",
        );
        return true;
      }

      // Edge case: no overlap but counts are similar (unusual)
      // Conservative approach: might be partial replacement or data quality issue
      // Don't act on this without additional evidence
      logger.debug(
        { platform, reviewIdOverlapCount, countRatio: countRatio.toFixed(2) },
        "No overlap but similar counts, conservative: not a replacement",
      );
      return false;
    }

    // 5. If review_ids DO overlap (some old data exists in new source)
    //    → normal incremental ingestion, NOT replacement
    if (reviewIdOverlapCount > 0) {
      logger.debug(
        { platform, reviewIdOverlapCount },
        "Review ID overlap detected, normal incremental ingestion",
      );
      return false;
    }

    logger.debug({ platform }, "No replacement detected");
    return false;
  } catch (err) {
    logger.error(
      { error: (err as Error).message, platform },
      "Error in replacement detection",
    );
    return false;
  }
}

/**
 * Clean up stale source data for any platform
 * Marketplace-agnostic cleanup of:
 * - normalized_reviews rows for deleted reviews
 * - product_dimension rows for products with no reviews
 * - product_daily_metrics rows for deleted dates
 */
export async function cleanupStaleSourceData(
  platform: Platform,
  transaction: Transaction,
): Promise<ReplacementCleanupResult> {
  const schema = config.appStore.schema;

  let staleReviewsDeleted = 0;
  let staleProductsDeleted = 0;
  let staleMetricsDeleted = 0;
  const affectedProducts: AffectedProduct[] = [];

  try {
    // Phase 1+2: Delete stale normalized_reviews
    // Find reviews in canonical that no longer exist in source
    // This works for any marketplace
    let staleReviewsQuery = "";
    if (platform === "flipkart") {
      staleReviewsQuery = `SELECT nr.canonical_review_id as "canonicalReviewId", nr.source_product_id as "sourceProductId"
       FROM "${schema}".normalized_reviews nr
       WHERE nr.platform = $1
         AND NOT EXISTS (
           SELECT 1 FROM "DataWarehouse".flipkart_reviews fr
           WHERE fr.product_id::text = nr.source_product_id
             AND fr.review_id = nr.source_review_id
         )`;
    } else if (platform === "myntra") {
      staleReviewsQuery = `SELECT nr.canonical_review_id as "canonicalReviewId", nr.source_product_id as "sourceProductId"
       FROM "${schema}".normalized_reviews nr
       WHERE nr.platform = $1
         AND NOT EXISTS (
           SELECT 1 FROM "DataWarehouse".myntra_reviews mr
           WHERE mr.product_id::text = nr.source_product_id
             AND mr.review_id = nr.source_review_id
         )`;
    }

    const staleReviews = await appSequelize.query<{
      canonicalReviewId: string;
      sourceProductId: string;
    }>(staleReviewsQuery, { type: QueryTypes.SELECT, bind: [platform], transaction });

    const staleReviewIds = (staleReviews || []).map((r) => r.canonicalReviewId);

    if (staleReviewIds.length > 0) {
      // Delete in batches to avoid query size limits
      // Must delete dependent tables first (foreign key constraints)
      const batchSize = 1000;
      for (let i = 0; i < staleReviewIds.length; i += batchSize) {
        const batch = staleReviewIds.slice(i, i + batchSize);
        // Delete from dependent tables (foreign keys reference normalized_reviews)
        await appSequelize.query(
          `DELETE FROM "${schema}".identity_anomalies
           WHERE canonical_review_id = ANY($1)`,
          { bind: [batch], transaction },
        );
        await appSequelize.query(
          `DELETE FROM "${schema}".review_sentiment
           WHERE canonical_review_id = ANY($1)`,
          { bind: [batch], transaction },
        );
        await appSequelize.query(
          `DELETE FROM "${schema}".review_theme
           WHERE canonical_review_id = ANY($1)`,
          { bind: [batch], transaction },
        );
        // Finally delete from normalized_reviews
        await appSequelize.query(
          `DELETE FROM "${schema}".normalized_reviews
           WHERE canonical_review_id = ANY($1)`,
          { bind: [batch], transaction },
        );
      }

      staleReviewsDeleted = staleReviewIds.length;
      logger.info(
        { platform, count: staleReviewsDeleted },
        "Deleted stale normalized_reviews",
      );
    }

    // Phase 3: Delete stale product_dimension
    const staleProducts = await appSequelize.query<{ sourceProductId: string }>(
      `SELECT DISTINCT pd.source_product_id as "sourceProductId"
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
         WHERE platform = $1
           AND source_product_id = ANY($2)`,
        { bind: [platform, staleProductIds], transaction },
      );

      staleProductsDeleted = staleProductIds.length;
      logger.info({ platform, count: staleProductsDeleted }, "Deleted stale product_dimension");
    }

    // Phase 4: Delete stale product_daily_metrics
    const staleMetrics = await appSequelize.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM "${schema}".product_daily_metrics pdm
       WHERE pdm.platform = $1
         AND NOT EXISTS (
           SELECT 1 FROM "${schema}".normalized_reviews nr
           WHERE nr.platform = $1
             AND nr.source_product_id = pdm.source_product_id
             AND nr.review_date = pdm.review_date
         )`,
      { type: QueryTypes.SELECT, transaction, bind: [platform] },
    );

    const staleMetricsCount = Number((staleMetrics && staleMetrics[0]?.count) || 0);

    if (staleMetricsCount > 0) {
      await appSequelize.query(
        `DELETE FROM "${schema}".product_daily_metrics pdm
         WHERE pdm.platform = $1
           AND NOT EXISTS (
             SELECT 1 FROM "${schema}".normalized_reviews nr
             WHERE nr.platform = $1
               AND nr.source_product_id = pdm.source_product_id
               AND nr.review_date = pdm.review_date
           )`,
        { transaction, bind: [platform] },
      );

      staleMetricsDeleted = staleMetricsCount;
      logger.info({ platform, count: staleMetricsDeleted }, "Deleted stale product_daily_metrics");
    }

    // Identify affected products (all products for platform with current reviews)
    const affectedProductsList = await appSequelize.query<{
      platform: string;
      sourceProductId: string;
    }>(
      `SELECT DISTINCT platform, source_product_id as "sourceProductId"
       FROM "${schema}".normalized_reviews
       WHERE platform = $1`,
      { type: QueryTypes.SELECT, bind: [platform], transaction },
    );

    (affectedProductsList || []).forEach((p) => {
      affectedProducts.push({
        platform: p.platform as Platform,
        sourceProductId: p.sourceProductId,
      });
    });

    logger.info(
      {
        platform,
        staleReviewsDeleted,
        staleProductsDeleted,
        staleMetricsDeleted,
        affectedProducts: affectedProducts.length,
      },
      "Source replacement cleanup complete",
    );

    return {
      staleReviewsDeleted,
      staleProductsDeleted,
      staleMetricsDeleted,
      affectedProducts,
    };
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
    throw err; // Let transaction rollback
  }
}
