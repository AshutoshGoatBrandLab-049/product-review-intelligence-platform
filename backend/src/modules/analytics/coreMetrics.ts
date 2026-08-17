import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { queryAggregatedMetrics, type MetricsFilter } from "./metricsQuery.js";
import { daysInWindow } from "./dateWindows.js";
import { classifyConfidence, type ConfidenceLevel } from "./confidence.js";

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

/**
 * Phase 3 §5 — core deterministic review metrics. Every field here is
 * computed from product_daily_metrics (never a raw normalized_reviews scan)
 * except uniqueAuthorStrings, which is separate and explicitly labeled — see
 * below.
 */
export interface CoreMetrics {
  totalReviews: number;
  averageRating: number | null; // null if totalReviews === 0 — never NaN
  ratingDistribution: RatingDistribution;
  ratingPercentages: RatingDistribution; // same keys, values are 0-100
  positivePercentage: number | null; // 4-5 star, null if totalReviews === 0
  negativePercentage: number | null; // 1-2 star
  neutralPercentage: number | null; // 3 star, excluded from positive/negative
  reviewVelocity: number; // reviews per day within the window
  uniqueProducts: number;
  confidence: ConfidenceLevel;
}

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10000) / 100;
}

export async function computeCoreMetrics(filter: MetricsFilter): Promise<CoreMetrics> {
  const totals = await queryAggregatedMetrics(filter);
  const { reviewCount } = totals;

  const ratingDistribution: RatingDistribution = {
    1: totals.rating1,
    2: totals.rating2,
    3: totals.rating3,
    4: totals.rating4,
    5: totals.rating5,
  };
  const ratingPercentages: RatingDistribution = {
    1: pct(totals.rating1, reviewCount),
    2: pct(totals.rating2, reviewCount),
    3: pct(totals.rating3, reviewCount),
    4: pct(totals.rating4, reviewCount),
    5: pct(totals.rating5, reviewCount),
  };

  return {
    totalReviews: reviewCount,
    averageRating: reviewCount === 0 ? null : Math.round((totals.ratingSum / reviewCount) * 100) / 100,
    ratingDistribution,
    ratingPercentages,
    positivePercentage: reviewCount === 0 ? null : pct(totals.positiveCount, reviewCount),
    negativePercentage: reviewCount === 0 ? null : pct(totals.negativeCount, reviewCount),
    neutralPercentage: reviewCount === 0 ? null : pct(totals.neutralCount, reviewCount),
    reviewVelocity: Math.round((reviewCount / daysInWindow(filter.window)) * 100) / 100,
    uniqueProducts: totals.uniqueProducts,
    confidence: classifyConfidence(reviewCount),
  };
}

/**
 * Phase 3 §5/§1 — "unique reviewers" is NOT a trustworthy metric: `author`
 * is a free-text marketplace display name, not a stable identity (see the
 * design doc). This function exists so the number is available if wanted,
 * but is deliberately named and documented so no caller mistakes it for a
 * count of real distinct people. It scans normalized_reviews directly
 * (not product_daily_metrics, which has no author dimension) — acceptable
 * since this is explicitly not a primary/high-frequency dashboard query.
 */
export async function countUniqueAuthorStrings(filter: MetricsFilter): Promise<number> {
  const schema = config.appStore.schema;
  const conditions: string[] = [`review_date >= :start`, `review_date <= :end`, `author IS NOT NULL`];
  const replacements: Record<string, string> = { start: filter.window.start, end: filter.window.end };
  if (filter.platform) {
    conditions.push(`platform = :platform`);
    replacements.platform = filter.platform;
  }
  if (filter.sourceProductId) {
    conditions.push(`source_product_id = :sourceProductId`);
    replacements.sourceProductId = filter.sourceProductId;
  }

  const [row] = await appSequelize.query<{ count: string }>(
    `SELECT count(DISTINCT author)::text AS count FROM "${schema}".normalized_reviews WHERE ${conditions.join(" AND ")}`,
    { type: QueryTypes.SELECT, replacements },
  );
  return Number(row!.count);
}
