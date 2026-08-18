import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { resolveNamedWindow, type NamedWindow, type DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

function isDateWindow(w: NamedWindow | DateWindow): w is DateWindow {
  return typeof w === "object" && w !== null && "start" in w && "end" in w;
}

/**
 * Phase 10 AI Product Analyst intent/context correction — Part B.
 *
 * Single, deterministic, DB-backed review retrieval path shared by:
 *   - GET /v1/products/:platform/:sourceProductId/reviews (unchanged behavior)
 *   - the AI Product Analyst's REVIEW_EXPLORATION / EVIDENCE_RETRIEVAL intent path
 *
 * Never invents reviews. Returns totalMatchingCount (pre-LIMIT) alongside the
 * capped page of reviews, so callers can truthfully report truncation
 * ("Found 37 matching reviews. Showing the latest 20.") instead of silently
 * capping and implying completeness.
 */

export interface ReviewRetrievalFilters {
  platform: Platform;
  sourceProductId: string;
  /**
   * Phase 10 query-understanding correction — accepts either the fixed
   * NamedWindow set OR a literal, already-resolved DateWindow (e.g. from
   * timeframeResolution.ts's "last 5 days" parsing), so a resolved timeframe
   * can actually override the window instead of being invisible to retrieval.
   */
  window: NamedWindow | DateWindow;
  limit?: number;
  rating?: number;
  sentiment?: "positive" | "neutral" | "negative";
  theme?: string;
  /**
   * Phase 10 query-understanding correction — explicit review-ID allowlist.
   * Needed because a conversational "show me" resolved against a prior
   * turn's aspect can name a SEMANTICALLY-discovered aspect (e.g.
   * "quality_issue") that was never persisted to the review_theme table —
   * review_theme is scoped to the fixed THEME_VOCABULARY only (see
   * reviewTheme.ts). Filtering by `theme` in that case would silently match
   * zero rows even though real reviews genuinely support that aspect. When
   * the caller already has the exact, DB-validated review IDs behind an
   * aspect (from the prior turn's deterministic evidence), it passes them
   * here instead of re-deriving a theme-column filter that can't see them.
   * Combined with other filters via AND, same as every other filter here.
   */
  reviewIds?: string[];
}

export interface RetrievedReview {
  canonicalReviewId: string;
  platform: string;
  sourceProductId: string;
  sourceReviewId: string;
  rating: number;
  title: string | null;
  reviewText: string | null;
  author: string | null;
  reviewDate: string;
  reviewTimestamp: string | null;
  dateConfidence: string | null;
  helpfulCount: number | null;
  notHelpfulCount: number | null;
  verifiedPurchase: boolean | null;
  hasImages: boolean | null;
  imageUrls: string[] | null;
  sizePurchased: string | null;
  colorPurchased: string | null;
  country: string | null;
  productUrl: string | null;
  brand: string | null;
  identityConfidence: string | null;
  sentiment: string | null;
  sentimentConfidence: number | null;
  sentimentModelVersion: string | null;
  themes: Array<{ theme: string; evidenceSnippet: string | null; confidence: number | null; modelVersion: string | null }>;
}

export interface ReviewRetrievalResult {
  reviews: RetrievedReview[];
  totalMatchingCount: number;
  requestedLimit: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

/**
 * Executes the actual filter + query logic, returning both the capped page
 * of reviews AND the total matching count (computed via COUNT(*) OVER()),
 * so truncation can be reported truthfully.
 */
export async function retrieveReviews(filters: ReviewRetrievalFilters): Promise<ReviewRetrievalResult> {
  const resolvedWindow = isDateWindow(filters.window) ? filters.window : resolveNamedWindow(filters.window);
  const schema = config.appStore.schema;

  const conditions: string[] = [
    `nr.platform = :platform`,
    `nr.source_product_id = :sourceProductId`,
    `nr.review_date >= :start`,
    `nr.review_date <= :end`,
  ];

  const replacements: Record<string, unknown> = {
    platform: filters.platform,
    sourceProductId: filters.sourceProductId,
    start: resolvedWindow.start,
    end: resolvedWindow.end,
  };

  if (filters.rating !== undefined) {
    conditions.push(`nr.rating = :rating`);
    replacements.rating = filters.rating;
  }

  if (filters.sentiment) {
    if (filters.sentiment === "negative") {
      conditions.push(`(rs.label = 'negative' OR nr.rating <= 2)`);
    } else if (filters.sentiment === "positive") {
      conditions.push(`(rs.label = 'positive' OR nr.rating >= 4)`);
    } else if (filters.sentiment === "neutral") {
      conditions.push(`(rs.label = 'neutral' OR nr.rating = 3)`);
    }
  }

  // reviewIds takes priority over theme when both are present: it is the
  // exact, already-validated set of reviews an aspect is grounded in
  // (including semantically-discovered aspects the review_theme table
  // doesn't know about at all — see the field doc on ReviewRetrievalFilters).
  if (filters.reviewIds && filters.reviewIds.length > 0) {
    conditions.push(`nr.canonical_review_id IN (:reviewIds)`);
    replacements.reviewIds = filters.reviewIds;
  } else if (filters.theme) {
    conditions.push(`rt.theme = :theme`);
    replacements.theme = filters.theme;
  }

  const whereClause = conditions.join(" AND ");
  const requestedLimit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Total matching count (pre-LIMIT, distinct reviews) — a separate,
  // simple COUNT(DISTINCT ...) query, since Postgres does not support
  // COUNT(DISTINCT ...) OVER() as a window function. This is what makes
  // "Found 37 matching reviews. Showing the latest 20." possible without
  // ever claiming "all" when the result was actually truncated.
  const countRows = (await appSequelize.query(
    `
    SELECT COUNT(DISTINCT nr.canonical_review_id) as total_matching_count
    FROM "${schema}".normalized_reviews nr
    LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = nr.canonical_review_id
    LEFT JOIN "${schema}".review_theme rt ON rt.canonical_review_id = nr.canonical_review_id
    WHERE ${whereClause}
    `,
    { replacements, type: QueryTypes.SELECT },
  )) as any[];
  const totalMatchingCount = Number(countRows[0]?.total_matching_count) || 0;

  const rows = (await appSequelize.query(
    `
    SELECT
      nr.canonical_review_id,
      nr.platform,
      nr.source_product_id,
      nr.source_review_id,
      nr.rating,
      nr.title,
      nr.review_text,
      nr.author,
      nr.review_date,
      nr.review_timestamp,
      nr.date_confidence,
      nr.helpful_count,
      nr.not_helpful_count,
      nr.verified_purchase,
      nr.has_images,
      nr.image_urls,
      nr.size_purchased,
      nr.color_purchased,
      nr.country,
      nr.product_url,
      nr.brand,
      nr.identity_confidence,
      rs.label as sentiment,
      rs.confidence as sentiment_confidence,
      rs.model_version as sentiment_model_version,
      rt.theme,
      rt.evidence_snippet as theme_evidence_snippet,
      rt.confidence as theme_confidence,
      rt.model_version as theme_model_version
    FROM "${schema}".normalized_reviews nr
    LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = nr.canonical_review_id
    LEFT JOIN "${schema}".review_theme rt ON rt.canonical_review_id = nr.canonical_review_id
    WHERE ${whereClause}
    ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC, nr.canonical_review_id, rt.theme
    `,
    { replacements, type: QueryTypes.SELECT },
  )) as any[];

  // Group by canonical_review_id (flatten themes), then cap to requestedLimit
  // AFTER grouping so the LIMIT applies to distinct reviews, not raw join rows.
  const reviewMap = new Map<string, RetrievedReview>();

  for (const row of rows) {
    const id = row.canonical_review_id;
    if (!reviewMap.has(id) && reviewMap.size >= requestedLimit) {
      continue;
    }
    if (!reviewMap.has(id)) {
      reviewMap.set(id, {
        canonicalReviewId: row.canonical_review_id,
        platform: row.platform,
        sourceProductId: row.source_product_id,
        sourceReviewId: row.source_review_id,
        rating: row.rating,
        title: row.title,
        reviewText: row.review_text,
        author: row.author,
        reviewDate: row.review_date,
        reviewTimestamp: row.review_timestamp,
        dateConfidence: row.date_confidence,
        helpfulCount: row.helpful_count,
        notHelpfulCount: row.not_helpful_count,
        verifiedPurchase: row.verified_purchase,
        hasImages: row.has_images,
        imageUrls: row.image_urls,
        sizePurchased: row.size_purchased,
        colorPurchased: row.color_purchased,
        country: row.country,
        productUrl: row.product_url,
        brand: row.brand,
        identityConfidence: row.identity_confidence,
        sentiment: row.sentiment,
        sentimentConfidence: row.sentiment_confidence,
        sentimentModelVersion: row.sentiment_model_version,
        themes: [],
      });
    }
    if (row.theme) {
      const review = reviewMap.get(id)!;
      if (!review.themes.some((t) => t.theme === row.theme)) {
        review.themes.push({
          theme: row.theme,
          evidenceSnippet: row.theme_evidence_snippet,
          confidence: row.theme_confidence,
          modelVersion: row.theme_model_version,
        });
      }
    }
  }

  return {
    reviews: Array.from(reviewMap.values()),
    totalMatchingCount,
    requestedLimit,
  };
}

/**
 * Hinglish/Roman-Hindi-aware natural language -> DB filter derivation.
 * Single source of truth for turning a free-text review request into
 * deterministic filters — supersedes the regex block that used to live
 * duplicated in the frontend (AIProductAnalyst.tsx handleExploreReviews).
 */
export function deriveReviewFiltersFromQuestion(question: string): {
  rating?: number;
  sentiment?: "positive" | "neutral" | "negative";
  theme?: string;
  limit?: number;
} {
  const q = question.toLowerCase();
  const result: { rating?: number; sentiment?: "positive" | "neutral" | "negative"; theme?: string; limit?: number } = {};

  // Count: "latest 20", "top 5", "show me 10", "first 3", "latest 20 reviews dikhao"
  const countMatch =
    q.match(/(\d+)\s*reviews?/i) ||
    q.match(/(?:latest|top|get|show me|first|last)\s+(\d+)/i);
  if (countMatch && countMatch[1]) {
    result.limit = Math.min(parseInt(countMatch[1], 10), 100);
  } else if (q.includes("latest") || q.includes("recent") || q.includes("newest")) {
    result.limit = 20;
  }

  // Rating: "1-star", "1 star"
  const ratingMatch = q.match(/(\d)\s*-?\s*star/i);
  if (ratingMatch && ratingMatch[1]) {
    result.rating = parseInt(ratingMatch[1], 10);
  }

  const negativeKeywords =
    /\b(bad|poor|terrible|awful|horrible|hate|hated|complain|complaint|issue|issues|problem|problems|broken|useless|waste|disappointed|disappointing|wrong|worse|worst|concern|concerns|negative|unhappy|unsatisfied|defect|defective|crash|crashed|faulty|fail|failed|malfunction|bug|bugs|bugged|error|errors|failure|failures|kharaab|kharab|ganda|bekaar|bekar)\b/i;

  const positiveKeywords =
    /\b(good|great|excellent|love|loved|amazing|perfect|wonderful|fantastic|awesome|impressed|satisfying|satisfied|happy|happiest|best|better|impressive|reliable|worth|valuable|superb|outstanding|brilliant|nice|lovely|achha|achhe|acche|badhiya|mast)\b/i;

  if (negativeKeywords.test(question)) {
    result.sentiment = "negative";
  } else if (positiveKeywords.test(question)) {
    result.sentiment = "positive";
  } else if (q.includes("neutral")) {
    result.sentiment = "neutral";
  }

  const themes = [
    "quality", "packaging", "delivery", "size", "fit", "comfort",
    "color", "durability", "value", "material", "product_mismatch",
  ];
  for (const theme of themes) {
    if (q.includes(theme)) {
      result.theme = theme;
      break;
    }
  }

  return result;
}
