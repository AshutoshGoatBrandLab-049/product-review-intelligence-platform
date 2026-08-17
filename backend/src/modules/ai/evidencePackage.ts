import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeProductAnalytics, type TrendDirection } from "../analytics/productAnalytics.js";
import { findEvidence } from "../analytics/evidence.js";
import type { DateWindow } from "../analytics/dateWindows.js";
import type { ConfidenceLevel } from "../analytics/confidence.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { RatingDistribution } from "../analytics/coreMetrics.js";

export interface ThemeCount {
  theme: string;
  count: number;
}

export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
}

/**
 * Phase 4 §16 — the deterministic evidence package. This is the ONLY input
 * the narrator (below) ever receives — never raw reviews, never database
 * internals. Every number in here comes from Phase 3's already-tested
 * analytics functions or a direct, auditable aggregate query; the narrator
 * may explain this data but cannot see anything beyond it.
 */
export interface ProductEvidencePackage {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  reviewCount: number;
  averageRating: number | null;
  ratingDistribution: RatingDistribution;
  positivePercentage: number | null;
  negativePercentage: number | null;
  trendDirection: TrendDirection;
  confidence: ConfidenceLevel;
  /** null if no review_sentiment rows exist yet for this product/window — never fabricated as zeros. */
  sentimentDistribution: SentimentDistribution | null;
  topThemes: ThemeCount[];
  topNegativeThemes: ThemeCount[];
  evidenceReviewIds: string[];
  totalMatchingNegativeCount: number;
  /**
   * Phase 4.1 remediation item 1 — a deterministic canonical_review_id -> theme[]
   * mapping, sourced directly from review_theme, scoped to exactly the reviews in
   * evidenceReviewIds. This is what makes citation *relevance* checkable (not just
   * citation *validity*): a narrator claim about theme X citing review Y is only
   * grounded if reviewThemes[Y] actually contains X. A review with no entry here
   * (or an empty array) has no theme evidence at all — Step 10 of Phase 4.1 showed
   * the narrator will otherwise still confidently invent a theme attribution for it.
   */
  reviewThemes: Record<string, string[]>;
}

export async function buildProductEvidencePackage(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
): Promise<ProductEvidencePackage> {
  const schema = config.appStore.schema;

  const [analytics, evidence, sentimentRows, themeRows, negThemeRows] = await Promise.all([
    computeProductAnalytics(platform, sourceProductId, window),
    findEvidence({ platform, sourceProductId, window, description: "rating <= 2", ratingIn: [1, 2] }),
    appSequelize.query<{ label: string; count: string }>(
      `SELECT rs.label, count(*)::text AS count
       FROM "${schema}".review_sentiment rs
       JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rs.canonical_review_id
       WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
         AND nr.review_date >= :start AND nr.review_date <= :end
       GROUP BY rs.label`,
      { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end } },
    ),
    appSequelize.query<{ theme: string; count: string }>(
      `SELECT rt.theme, count(*)::text AS count
       FROM "${schema}".review_theme rt
       JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rt.canonical_review_id
       WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
         AND nr.review_date >= :start AND nr.review_date <= :end
       GROUP BY rt.theme ORDER BY count(*) DESC LIMIT 5`,
      { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end } },
    ),
    appSequelize.query<{ theme: string; count: string }>(
      `SELECT rt.theme, count(*)::text AS count
       FROM "${schema}".review_theme rt
       JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rt.canonical_review_id
       WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
         AND nr.review_date >= :start AND nr.review_date <= :end AND nr.rating <= 2
       GROUP BY rt.theme ORDER BY count(*) DESC LIMIT 5`,
      { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end } },
    ),
  ]);

  let sentimentDistribution: SentimentDistribution | null = null;
  if (sentimentRows.length > 0) {
    sentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    for (const row of sentimentRows) {
      sentimentDistribution[row.label as keyof SentimentDistribution] = Number(row.count);
    }
  }

  // Phase 4.1 remediation item 1 — per-review theme grounding, scoped to only
  // the reviews actually being handed to the narrator as citable evidence.
  const reviewThemes: Record<string, string[]> = {};
  if (evidence.canonicalReviewIds.length > 0) {
    const perReviewThemeRows = await appSequelize.query<{ canonical_review_id: string; theme: string }>(
      `SELECT canonical_review_id, theme FROM "${schema}".review_theme WHERE canonical_review_id IN (:ids)`,
      { type: QueryTypes.SELECT, replacements: { ids: evidence.canonicalReviewIds } },
    );
    for (const row of perReviewThemeRows) {
      (reviewThemes[row.canonical_review_id] ??= []).push(row.theme);
    }
  }

  return {
    platform,
    sourceProductId,
    window,
    reviewCount: analytics.recentMetrics.totalReviews,
    averageRating: analytics.recentMetrics.averageRating,
    ratingDistribution: analytics.recentMetrics.ratingDistribution,
    positivePercentage: analytics.recentMetrics.positivePercentage,
    negativePercentage: analytics.recentMetrics.negativePercentage,
    trendDirection: analytics.trendDirection,
    confidence: analytics.recentMetrics.confidence,
    sentimentDistribution,
    topThemes: themeRows.map((r) => ({ theme: r.theme, count: Number(r.count) })),
    topNegativeThemes: negThemeRows.map((r) => ({ theme: r.theme, count: Number(r.count) })),
    evidenceReviewIds: evidence.canonicalReviewIds,
    reviewThemes,
    totalMatchingNegativeCount: evidence.totalMatchingCount,
  };
}
