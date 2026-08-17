import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { logger } from "../../shared/logger.js";

export interface RebuildResult {
  status: "success" | "failed";
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  normalizedReviewsRead: number;
  productDimensionRowsWritten: number;
  productDailyMetricsRowsWritten: number;
  brandInconsistentProducts: number;
  validationPassed: boolean;
  error?: string;
}

/**
 * Phase 3 §17/§19 — full rebuild of product_dimension and
 * product_daily_metrics from normalized_reviews's CURRENT state. Not
 * incremental: every row, every time. This is what makes late-arriving
 * reviews (Track A) and changed reviews (Track B updates) both "just work"
 * with no separate invalidation logic — see the design doc for why this
 * trade (simplicity/correctness over incremental speed) was chosen given the
 * daily batch cadence.
 *
 * Runs entirely inside one transaction: TRUNCATE + INSERT...SELECT for both
 * tables, then a validation check (SUM(review_count) must equal
 * COUNT(normalized_reviews)) BEFORE committing. A validation failure rolls
 * back the whole rebuild — the prior aggregate contents are left completely
 * untouched rather than replaced with something wrong ("do not silently mark
 * analytics as fresh when rebuild fails").
 */
export async function rebuildAnalytics(): Promise<RebuildResult> {
  const startedAt = new Date();
  const schema = config.appStore.schema;

  try {
    const result = await appSequelize.transaction(async (t) => {
      const [normalizedCountRow] = await appSequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}".normalized_reviews`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      const normalizedCount = normalizedCountRow!.count;

      await appSequelize.query(`TRUNCATE "${schema}".product_daily_metrics`, { transaction: t });
      await appSequelize.query(`TRUNCATE "${schema}".product_dimension`, { transaction: t });

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
           now()
         FROM "${schema}".normalized_reviews
         GROUP BY platform, source_product_id, review_date`,
        { transaction: t },
      );

      // Deterministic brand selection: latest review_date, tie-break source_row_id DESC.
      await appSequelize.query(
        `WITH ranked AS (
           SELECT platform, source_product_id, brand, product_url,
                  row_number() OVER (
                    PARTITION BY platform, source_product_id
                    ORDER BY review_date DESC, source_row_id DESC
                  ) AS rn
           FROM "${schema}".normalized_reviews
         ),
         latest AS (
           SELECT platform, source_product_id, brand, product_url FROM ranked WHERE rn = 1
         ),
         brand_counts AS (
           SELECT platform, source_product_id,
                  count(DISTINCT brand) FILTER (WHERE brand IS NOT NULL) AS distinct_brands
           FROM "${schema}".normalized_reviews
           GROUP BY platform, source_product_id
         ),
         agg AS (
           SELECT platform, source_product_id,
                  min(review_date) AS first_review_date,
                  max(review_date) AS last_review_date,
                  count(*) AS total_review_count
           FROM "${schema}".normalized_reviews
           GROUP BY platform, source_product_id
         )
         INSERT INTO "${schema}".product_dimension
           (platform, source_product_id, brand, brand_inconsistent, product_url,
            first_review_date, last_review_date, total_review_count, last_rebuilt_at)
         SELECT
           l.platform, l.source_product_id, l.brand,
           COALESCE(bc.distinct_brands, 0) > 1,
           l.product_url, a.first_review_date, a.last_review_date, a.total_review_count, now()
         FROM latest l
         JOIN agg a ON a.platform = l.platform AND a.source_product_id = l.source_product_id
         LEFT JOIN brand_counts bc ON bc.platform = l.platform AND bc.source_product_id = l.source_product_id`,
        { transaction: t },
      );

      const [dimCountRow] = await appSequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}".product_dimension`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      const [dailyCountRow] = await appSequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}".product_daily_metrics`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      const [dailySumRow] = await appSequelize.query<{ sum: string | null }>(
        `SELECT sum(review_count)::text AS sum FROM "${schema}".product_daily_metrics`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      const [inconsistentRow] = await appSequelize.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}".product_dimension WHERE brand_inconsistent = true`,
        { type: QueryTypes.SELECT, transaction: t },
      );

      const dailySum = Number(dailySumRow?.sum ?? "0");

      // Validation: every normalized review must be counted exactly once.
      // A mismatch here means the rebuild is wrong — roll back, don't ship it.
      if (dailySum !== Number(normalizedCount)) {
        throw new Error(
          `Rebuild validation failed: SUM(product_daily_metrics.review_count)=${dailySum} !== COUNT(normalized_reviews)=${normalizedCount}`,
        );
      }

      return {
        normalizedReviewsRead: Number(normalizedCount),
        productDimensionRowsWritten: Number(dimCountRow!.count),
        productDailyMetricsRowsWritten: Number(dailyCountRow!.count),
        brandInconsistentProducts: Number(inconsistentRow!.count),
      };
    });

    const finishedAt = new Date();
    const finalResult: RebuildResult = {
      status: "success",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      validationPassed: true,
      ...result,
    };
    logger.info(
      {
        status: finalResult.status,
        durationMs: finalResult.durationMs,
        normalizedReviewsRead: finalResult.normalizedReviewsRead,
        productDimensionRowsWritten: finalResult.productDimensionRowsWritten,
        productDailyMetricsRowsWritten: finalResult.productDailyMetricsRowsWritten,
        brandInconsistentProducts: finalResult.brandInconsistentProducts,
      },
      "Analytics rebuild complete",
    );
    return finalResult;
  } catch (err) {
    const finishedAt = new Date();
    const failedResult: RebuildResult = {
      status: "failed",
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      normalizedReviewsRead: 0,
      productDimensionRowsWritten: 0,
      productDailyMetricsRowsWritten: 0,
      brandInconsistentProducts: 0,
      validationPassed: false,
      error: (err as Error).message,
    };
    logger.error({ status: "failed", error: failedResult.error, durationMs: failedResult.durationMs }, "Analytics rebuild failed");
    return failedResult;
  }
}
