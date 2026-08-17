import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeProductAnalytics } from "./productAnalytics.js";
import type { DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 3 approved, reconfirmed in Phase 4: the Phase 2 weights are carried
 * forward ONLY as the default for "health-v0-hypothesis" — explicitly a
 * hypothesis, not a business-approved formula. Configurable so a future
 * version can change weights without touching calculation code. Unchanged
 * by Phase 4 — no silent reweighting.
 */
export const HEALTH_SCORE_WEIGHTS_V0 = {
  rating: 0.30,
  sentiment: 0.25,
  complaint: 0.20,
  severity: 0.15,
  trend: 0.10,
} as const;

export interface HealthScore {
  scopeType: "product";
  platform: Platform;
  sourceProductId: string;
  ratingScore: number; // 0-100, computable now
  sentimentScore: number | null; // Phase 4: available once validated review_sentiment rows exist for this product/window
  complaintScore: number | null; // Phase 4: available once validated review_theme rows exist for this product/window
  severityScore: null; // still not_ready — no approved severity formula (Phase 4 §19)
  trendScore: number; // 0-100, computable now
  totalScore: null; // NEVER computed while any required component is null — no renormalization, no partial score presented as complete
  version: "health-v0-hypothesis";
  weights: typeof HEALTH_SCORE_WEIGHTS_V0;
  computedAt: Date;
}

/** Rating 1-5 -> 0-100 linear scale. */
function ratingToScore(averageRating: number | null): number {
  if (averageRating === null) return 0;
  return Math.round(((averageRating - 1) / 4) * 10000) / 100;
}

/**
 * Trend score: a rating-percentage-delta clamped to [-50%, +50%] and mapped
 * onto 0-100, centered at 50 (no change = 50). Documented as a Phase 3
 * placeholder formula alongside the health score itself — not claimed as
 * business-approved, same caveat as the overall weights.
 */
function trendToScore(percentageDelta: number | null): number {
  if (percentageDelta === null) return 50;
  const clamped = Math.max(-50, Math.min(50, percentageDelta));
  return Math.round((50 + clamped) * 100) / 100;
}

/**
 * Sentiment score: (positive - negative) / total, mapped from [-100%,+100%]
 * onto 0-100, centered at 50. Same "placeholder formula, not business
 * approved" caveat as trendToScore — returns null (not 50) when there is no
 * data at all, so an unclassified product is never confused with a
 * genuinely neutral one.
 */
async function computeSentimentScore(platform: Platform, sourceProductId: string, window: DateWindow): Promise<number | null> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ positive: string; negative: string; total: string }>(
    `SELECT
       count(*) FILTER (WHERE rs.label = 'positive')::text AS positive,
       count(*) FILTER (WHERE rs.label = 'negative')::text AS negative,
       count(*)::text AS total
     FROM "${schema}".review_sentiment rs
     JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rs.canonical_review_id
     WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
       AND nr.review_date >= :start AND nr.review_date <= :end`,
    { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end } },
  );

  const total = Number(row!.total);
  if (total === 0) return null; // no validated sentiment data yet — never fabricated as neutral

  const positive = Number(row!.positive);
  const negative = Number(row!.negative);
  const balance = ((positive - negative) / total) * 100; // -100..100
  return Math.round((50 + balance / 2) * 100) / 100;
}

/**
 * Complaint score: 100 = no negative-review theme mentions observed, lower
 * = more frequent. Computed only from NEGATIVE reviews' themes (rating<=2)
 * — a "quality" theme on a 5-star review isn't a complaint. Returns null
 * when there is no theme data at all for this product/window.
 */
async function computeComplaintScore(platform: Platform, sourceProductId: string, window: DateWindow): Promise<number | null> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ negative_reviews: string; theme_mentions: string }>(
    `SELECT
       count(DISTINCT nr.canonical_review_id) FILTER (WHERE nr.rating <= 2)::text AS negative_reviews,
       count(rt.id) FILTER (WHERE nr.rating <= 2)::text AS theme_mentions
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_theme rt ON rt.canonical_review_id = nr.canonical_review_id
     WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
       AND nr.review_date >= :start AND nr.review_date <= :end
       AND EXISTS (SELECT 1 FROM "${schema}".review_theme rt2 WHERE rt2.canonical_review_id = nr.canonical_review_id)`,
    { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end } },
  );

  const negativeReviews = Number(row?.negative_reviews ?? "0");
  if (negativeReviews === 0) return null; // no theme-classified negative reviews yet

  const themeMentions = Number(row?.theme_mentions ?? "0");
  const avgThemesPerNegativeReview = themeMentions / negativeReviews; // typically 0-3ish
  const penalty = Math.min(100, avgThemesPerNegativeReview * 33.33);
  return Math.round((100 - penalty) * 100) / 100;
}

export async function computeHealthScore(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
): Promise<HealthScore> {
  const [analytics, sentimentScore, complaintScore] = await Promise.all([
    computeProductAnalytics(platform, sourceProductId, window),
    computeSentimentScore(platform, sourceProductId, window),
    computeComplaintScore(platform, sourceProductId, window),
  ]);

  return {
    scopeType: "product",
    platform,
    sourceProductId,
    ratingScore: ratingToScore(analytics.recentMetrics.averageRating),
    sentimentScore,
    complaintScore,
    severityScore: null,
    trendScore: trendToScore(analytics.ratingComparison.percentageDelta),
    totalScore: null, // severityScore is always null in Phase 4 — never all 5 components present
    version: "health-v0-hypothesis",
    weights: HEALTH_SCORE_WEIGHTS_V0,
    computedAt: new Date(),
  };
}
