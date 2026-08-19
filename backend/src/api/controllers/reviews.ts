import type { Request, Response } from "express";
import type { ProductReviewsQuery } from "../schemas.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { ProductParams } from "../schemas.js";
import { retrieveReviews } from "../../modules/analytics/reviewRetrieval.js";
import { getProductsRankedByNegativeReviews, getProductsRankedByPositiveReviews } from "../../database/queries/productRankingQueries.js";
import type { Platform } from "../../types/unifiedReview.js";

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

  const result = await retrieveReviews({ platform, sourceProductId, window, limit, rating, sentiment, theme });

  res.json({
    reviews: result.reviews,
    count: result.reviews.length,
    totalMatchingCount: result.totalMatchingCount,
    requestedLimit: result.requestedLimit,
  });
}

/**
 * Phase 10 — Product Review Overview
 * Returns products ranked by negative or positive reviews in their latest 10 reviews.
 * Query params: platform, type (negative|positive), page (default 0)
 */
export async function getReviewsOverview(req: Request, res: Response): Promise<void> {
  const { platform, type } = req.query;
  const page = parseInt(String(req.query.page || "0"), 10);
  const pageSize = 100;
  const offset = page * pageSize;

  if (!platform || typeof platform !== "string") {
    res.status(400).json({ error: "platform query parameter required" });
    return;
  }

  if (!["flipkart", "myntra"].includes(platform)) {
    res.status(400).json({ error: "platform must be flipkart or myntra" });
    return;
  }

  if (type !== "negative" && type !== "positive") {
    res.status(400).json({ error: "type must be negative or positive" });
    return;
  }

  try {
    const result =
      type === "negative"
        ? await getProductsRankedByNegativeReviews(platform as Platform, pageSize, offset)
        : await getProductsRankedByPositiveReviews(platform as Platform, pageSize, offset);

    const totalPages = Math.ceil(result.total / pageSize);

    res.json({
      products: result.products,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch products overview" });
  }
}
