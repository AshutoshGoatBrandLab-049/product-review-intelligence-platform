import type { Request, Response } from "express";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { QueryTypes } from "sequelize";
import type { EvidenceReviewsQuery } from "../schemas.js";
import { getValidatedQuery } from "../middleware/validate.js";

/**
 * Phase 8 Step 7 — Evidence & Actual Review Investigation.
 * Returns the actual stored review data (author, review_text, title, etc.)
 * for the analyst investigation workflow.
 *
 * This endpoint serves real customer review content for evidence-first
 * product investigation. No fabrication, no transformation of review text.
 */
export async function getEvidenceReviews(req: Request, res: Response): Promise<void> {
  const { canonicalReviewIds: reviewIdsParam } = getValidatedQuery<EvidenceReviewsQuery>(req);

  const schema = config.appStore.schema;
  const canonicalReviewIds = reviewIdsParam.split(",").slice(0, 100);

  // Build named placeholders for each ID (:id0, :id1, :id2, etc.)
  const placeholders = canonicalReviewIds.map((_, i) => `:id${i}`).join(", ");
  const replacements = Object.fromEntries(canonicalReviewIds.map((id, i) => [`id${i}`, id]));

  // Query reviews by canonical_review_id with sentiment/theme data
  // Note: SELECT DISTINCT requires all ORDER BY expressions to be in SELECT list
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
    WHERE nr.canonical_review_id IN (${placeholders})
    ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC, nr.canonical_review_id, rt.theme
    `,
    {
      replacements,
      type: QueryTypes.SELECT,
    },
  )) as any[];

  // Group reviews by canonical_review_id and flatten themes
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
  });
}
