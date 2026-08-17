import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import type { DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

export interface RawMetricsTotals {
  reviewCount: number;
  ratingSum: number;
  rating1: number;
  rating2: number;
  rating3: number;
  rating4: number;
  rating5: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  helpfulCountSum: number;
  uniqueProducts: number;
}

export interface MetricsFilter {
  window: DateWindow;
  platform?: Platform;
  sourceProductId?: string;
  brand?: string; // requires a join to product_dimension — see queryAggregatedMetrics
}

/**
 * The single query underneath every rollup in Phase 3 (core/product/brand/
 * platform analytics) — always reads product_daily_metrics, never scans
 * normalized_reviews, per §17/§18. Filtering by brand requires a join to
 * product_dimension since brand is a per-product dimension, not part of the
 * daily-grain table itself (Phase 3 §8 design decision).
 */
export async function queryAggregatedMetrics(filter: MetricsFilter): Promise<RawMetricsTotals> {
  const schema = config.appStore.schema;
  const conditions: string[] = [`d.review_date >= :start`, `d.review_date <= :end`];
  const replacements: Record<string, string> = { start: filter.window.start, end: filter.window.end };

  if (filter.platform) {
    conditions.push(`d.platform = :platform`);
    replacements.platform = filter.platform;
  }
  if (filter.sourceProductId) {
    conditions.push(`d.source_product_id = :sourceProductId`);
    replacements.sourceProductId = filter.sourceProductId;
  }

  const needsBrandJoin = filter.brand !== undefined;
  const joinClause = needsBrandJoin
    ? `JOIN "${schema}".product_dimension p ON p.platform = d.platform AND p.source_product_id = d.source_product_id`
    : "";
  if (needsBrandJoin) {
    conditions.push(`p.brand = :brand`);
    replacements.brand = filter.brand!;
  }

  const [row] = await appSequelize.query<{
    review_count: string | null;
    rating_sum: string | null;
    rating_1: string | null;
    rating_2: string | null;
    rating_3: string | null;
    rating_4: string | null;
    rating_5: string | null;
    positive_count: string | null;
    negative_count: string | null;
    neutral_count: string | null;
    helpful_count_sum: string | null;
    unique_products: string | null;
  }>(
    `SELECT
       coalesce(sum(d.review_count), 0)::text AS review_count,
       coalesce(sum(d.rating_sum), 0)::text AS rating_sum,
       coalesce(sum(d.rating_1_count), 0)::text AS rating_1,
       coalesce(sum(d.rating_2_count), 0)::text AS rating_2,
       coalesce(sum(d.rating_3_count), 0)::text AS rating_3,
       coalesce(sum(d.rating_4_count), 0)::text AS rating_4,
       coalesce(sum(d.rating_5_count), 0)::text AS rating_5,
       coalesce(sum(d.positive_count), 0)::text AS positive_count,
       coalesce(sum(d.negative_count), 0)::text AS negative_count,
       coalesce(sum(d.neutral_count), 0)::text AS neutral_count,
       coalesce(sum(d.helpful_count_sum), 0)::text AS helpful_count_sum,
       count(DISTINCT (d.platform, d.source_product_id))::text AS unique_products
     FROM "${schema}".product_daily_metrics d
     ${joinClause}
     WHERE ${conditions.join(" AND ")}`,
    { type: QueryTypes.SELECT, replacements },
  );

  return {
    reviewCount: Number(row!.review_count),
    ratingSum: Number(row!.rating_sum),
    rating1: Number(row!.rating_1),
    rating2: Number(row!.rating_2),
    rating3: Number(row!.rating_3),
    rating4: Number(row!.rating_4),
    rating5: Number(row!.rating_5),
    positiveCount: Number(row!.positive_count),
    negativeCount: Number(row!.negative_count),
    neutralCount: Number(row!.neutral_count),
    helpfulCountSum: Number(row!.helpful_count_sum),
    uniqueProducts: Number(row!.unique_products),
  };
}
