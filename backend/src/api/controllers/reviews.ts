import type { Request, Response } from "express";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { QueryTypes } from "sequelize";
import type { ProductReviewsQuery } from "../schemas.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { ProductParams } from "../schemas.js";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";

/**
 * Phase 10 Step 2 — Review exploration endpoint.
 * Retrieves actual product reviews filtered/sorted by database-authoritative criteria.
 * DISTINCT from GET /v1/evidence/reviews (which takes explicit canonical IDs).
 * This endpoint enables queries like "show me the latest 20 reviews" or "show me negative reviews".
 *
 * FLOW B (Review Exploration):
 * User asks for reviews → database filters/sorts → actual stored reviews → display.
 *
 * Preserves LATEST→OLDEST ordering: COALESCE(review_timestamp, review_date::timestamp) DESC
 */

export async function getProductReviews(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const { window, limit, rating, sentiment, theme } = getValidatedQuery<ProductReviewsQuery>(req);

  const resolvedWindow = resolveNamedWindow(window);
  const schema = config.appStore.schema;

  // Build WHERE conditions dynamically
  const conditions: string[] = [
    `nr.platform = :platform`,
    `nr.source_product_id = :sourceProductId`,
    `nr.review_date >= :start`,
    `nr.review_date <= :end`,
  ];

  const replacements: Record<string, unknown> = {
    platform,
    sourceProductId,
    start: resolvedWindow.start,
    end: resolvedWindow.end,
  };

  if (rating !== undefined) {
    conditions.push(`nr.rating = :rating`);
    replacements.rating = rating;
  }

  if (sentiment) {
    conditions.push(`rs.label = :sentiment`);
    replacements.sentiment = sentiment;
  }

  if (theme) {
    conditions.push(`rt.theme = :theme`);
    replacements.theme = theme;
  }

  const whereClause = conditions.join(" AND ");
  const limitClause = limit ? `LIMIT ${Math.min(limit, 100)}` : "LIMIT 100";

  // Query reviews with sentiment/theme data, using deterministic ordering
  const reviews = (await appSequelize.query(
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
    ${limitClause}
    `,
    {
      replacements,
      type: QueryTypes.SELECT,
    },
  )) as any[];

  // Group reviews by canonical_review_id and flatten themes (same pattern as evidence.ts)
  const reviewMap = new Map<string, any>();
  for (const row of reviews) {
    const id = row.canonical_review_id;
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
      if (!review.themes.some((t: any) => t.theme === row.theme)) {
        review.themes.push({
          theme: row.theme,
          evidenceSnippet: row.theme_evidence_snippet,
          confidence: row.theme_confidence,
          modelVersion: row.theme_model_version,
        });
      }
    }
  }

  res.json({
    reviews: Array.from(reviewMap.values()),
    count: reviewMap.size,
    requestedLimit: limit || 100,
  });
}
