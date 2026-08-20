/**
 * Incremental synchronization of product_dimension and product_daily_metrics
 * Called within transaction boundaries during ingestion (TrackA/TrackB).
 * Must be called WITHIN the transaction that modifies normalized_reviews.
 */

import { QueryTypes, Transaction } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { logger } from "../../shared/logger.js";
import type { Platform } from "../../types/unifiedReview.js";

export interface AffectedProduct {
  platform: Platform;
  sourceProductId: string;
}

/**
 * Synchronize product_dimension for affected products
 * Must be called within a transaction that has modified normalized_reviews
 */
export async function synchronizeProductDimension(
  products: AffectedProduct[],
  transaction: Transaction,
): Promise<void> {
  if (products.length === 0) return;

  const schema = config.appStore.schema;

  // For each affected (platform, sourceProductId), ensure product_dimension row exists
  // with latest values (deterministic: latest review_date, tie-break source_row_id DESC)
  for (const product of products) {
    const { platform, sourceProductId } = product;

    // Check if row exists
    const [existing] = await appSequelize.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM "${schema}".product_dimension
         WHERE platform = $1 AND source_product_id = $2
       ) AS exists`,
      {
        bind: [platform, sourceProductId],
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    const rowExists = (existing as any)?.exists || false;

    // Fetch latest data from normalized_reviews for this product
    const [latestRow] = await appSequelize.query<{
      brand: string | null;
      product_url: string | null;
      first_review_date: string;
      last_review_date: string;
      total_review_count: number;
      distinct_brands: number;
    }>(
      `WITH ranked AS (
         SELECT platform, source_product_id, brand, product_url,
                row_number() OVER (
                  PARTITION BY platform, source_product_id
                  ORDER BY review_date DESC, source_row_id DESC
                ) AS rn
         FROM "${schema}".normalized_reviews
         WHERE platform = $1 AND source_product_id = $2
       ),
       latest AS (
         SELECT platform, source_product_id, brand, product_url FROM ranked WHERE rn = 1
       ),
       brand_counts AS (
         SELECT count(DISTINCT brand) FILTER (WHERE brand IS NOT NULL) AS distinct_brands
         FROM "${schema}".normalized_reviews
         WHERE platform = $1 AND source_product_id = $2
       ),
       agg AS (
         SELECT min(review_date) AS first_review_date,
                max(review_date) AS last_review_date,
                count(*) AS total_review_count
         FROM "${schema}".normalized_reviews
         WHERE platform = $1 AND source_product_id = $2
       )
       SELECT l.brand, l.product_url, a.first_review_date, a.last_review_date,
              a.total_review_count, bc.distinct_brands
       FROM latest l, agg a, brand_counts bc`,
      {
        bind: [platform, sourceProductId],
        type: QueryTypes.SELECT,
        transaction,
      },
    );

    if (!latestRow) return; // No reviews for this product

    const distinctBrands = (latestRow as any)?.distinct_brands || 0;
    const brand = (latestRow as any)?.brand;
    const productUrl = (latestRow as any)?.product_url;
    const firstReviewDate = (latestRow as any)?.first_review_date;
    const lastReviewDate = (latestRow as any)?.last_review_date;
    const totalReviewCount = (latestRow as any)?.total_review_count;

    const brandInconsistent = distinctBrands > 1;
    const now = new Date().toISOString();

    if (rowExists) {
      // UPSERT: only update lastRebuiltAt if ANY business value changed
      await appSequelize.query(
        `UPDATE "${schema}".product_dimension
         SET brand = $3,
             brand_inconsistent = $4,
             product_url = $5,
             first_review_date = $6,
             last_review_date = $7,
             total_review_count = $8,
             last_rebuilt_at = CASE
               WHEN brand != $3 OR brand_inconsistent != $4 OR product_url != $5 OR
                    first_review_date != $6 OR last_review_date != $7 OR
                    total_review_count != $8
               THEN $9
               ELSE last_rebuilt_at
             END
         WHERE platform = $1 AND source_product_id = $2`,
        {
          bind: [
            platform,
            sourceProductId,
            brand,
            brandInconsistent,
            productUrl,
            firstReviewDate,
            lastReviewDate,
            totalReviewCount,
            now,
          ],
          transaction,
        },
      );
    } else {
      // INSERT new row
      await appSequelize.query(
        `INSERT INTO "${schema}".product_dimension
         (platform, source_product_id, brand, brand_inconsistent, product_url,
          first_review_date, last_review_date, total_review_count, last_rebuilt_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        {
          bind: [
            platform,
            sourceProductId,
            brand,
            brandInconsistent,
            productUrl,
            firstReviewDate,
            lastReviewDate,
            totalReviewCount,
            now,
          ],
          transaction,
        },
      );
    }
  }
}

/**
 * Synchronize product_daily_metrics for affected products
 * Must be called within a transaction that has modified normalized_reviews
 */
export async function synchronizeProductDailyMetrics(
  products: AffectedProduct[],
  transaction: Transaction,
): Promise<void> {
  if (products.length === 0) return;

  const schema = config.appStore.schema;

  // For each affected (platform, sourceProductId), rebuild ALL daily metrics rows
  for (const product of products) {
    const { platform, sourceProductId } = product;

    // Delete stale rows (dates with zero reviews)
    await appSequelize.query(
      `DELETE FROM "${schema}".product_daily_metrics
       WHERE platform = $1 AND source_product_id = $2 AND
             (SELECT count(*) FROM "${schema}".normalized_reviews nr
              WHERE nr.platform = $1 AND nr.source_product_id = $2 AND
                    nr.review_date = "${schema}".product_daily_metrics.review_date) = 0`,
      {
        bind: [platform, sourceProductId],
        transaction,
      },
    );

    // Upsert: insert or replace daily metrics rows
    const now = new Date().toISOString();
    await appSequelize.query(
      `INSERT INTO "${schema}".product_daily_metrics
       (platform, source_product_id, review_date, review_count, rating_sum,
        rating_1_count, rating_2_count, rating_3_count, rating_4_count, rating_5_count,
        positive_count, negative_count, neutral_count, helpful_count_sum, last_rebuilt_at)
       SELECT
         platform, source_product_id, review_date,
         count(*) AS review_count,
         sum(rating) AS rating_sum,
         count(*) FILTER (WHERE rating = 1) AS rating_1_count,
         count(*) FILTER (WHERE rating = 2) AS rating_2_count,
         count(*) FILTER (WHERE rating = 3) AS rating_3_count,
         count(*) FILTER (WHERE rating = 4) AS rating_4_count,
         count(*) FILTER (WHERE rating = 5) AS rating_5_count,
         count(*) FILTER (WHERE rating IN (4,5)) AS positive_count,
         count(*) FILTER (WHERE rating IN (1,2)) AS negative_count,
         count(*) FILTER (WHERE rating = 3) AS neutral_count,
         coalesce(sum(helpful_count), 0) AS helpful_count_sum,
         $3
       FROM "${schema}".normalized_reviews
       WHERE platform = $1 AND source_product_id = $2
       GROUP BY platform, source_product_id, review_date
       ON CONFLICT (platform, source_product_id, review_date)
       DO UPDATE SET
         review_count = EXCLUDED.review_count,
         rating_sum = EXCLUDED.rating_sum,
         rating_1_count = EXCLUDED.rating_1_count,
         rating_2_count = EXCLUDED.rating_2_count,
         rating_3_count = EXCLUDED.rating_3_count,
         rating_4_count = EXCLUDED.rating_4_count,
         rating_5_count = EXCLUDED.rating_5_count,
         positive_count = EXCLUDED.positive_count,
         negative_count = EXCLUDED.negative_count,
         neutral_count = EXCLUDED.neutral_count,
         helpful_count_sum = EXCLUDED.helpful_count_sum,
         last_rebuilt_at = CASE
           WHEN product_daily_metrics.review_count != EXCLUDED.review_count OR
                product_daily_metrics.rating_sum != EXCLUDED.rating_sum OR
                product_daily_metrics.rating_1_count != EXCLUDED.rating_1_count OR
                product_daily_metrics.rating_2_count != EXCLUDED.rating_2_count OR
                product_daily_metrics.rating_3_count != EXCLUDED.rating_3_count OR
                product_daily_metrics.rating_4_count != EXCLUDED.rating_4_count OR
                product_daily_metrics.rating_5_count != EXCLUDED.rating_5_count OR
                product_daily_metrics.positive_count != EXCLUDED.positive_count OR
                product_daily_metrics.negative_count != EXCLUDED.negative_count OR
                product_daily_metrics.neutral_count != EXCLUDED.neutral_count OR
                product_daily_metrics.helpful_count_sum != EXCLUDED.helpful_count_sum
           THEN $3
           ELSE product_daily_metrics.last_rebuilt_at
         END`,
      {
        bind: [platform, sourceProductId, now],
        transaction,
      },
    );
  }
}
