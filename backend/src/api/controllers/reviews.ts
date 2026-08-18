import type { Request, Response } from "express";
import type { ProductReviewsQuery } from "../schemas.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { ProductParams } from "../schemas.js";
import { retrieveReviews } from "../../modules/analytics/reviewRetrieval.js";

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
