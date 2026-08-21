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
 * Returns products ranked by negative or positive reviews in their latest N reviews or custom date range.
 * Query params: platform, type (negative|positive), page (default 0), reviewWindow (default latest10),
 *              customFromDate, customToDate (required if reviewWindow=custom)
 */
export async function getReviewsOverview(req: Request, res: Response): Promise<void> {
  const { platform, type, reviewWindow, sortBy, nocache } = req.query;
  const page = parseInt(String(req.query.page || "0"), 10);
  const pageSize = 100;
  const offset = page * pageSize;
  const bypassCache = nocache === "true";

  // Parse review window
  const windowType = String(reviewWindow || "latest10");
  let reviewLimit = 10;
  if (windowType === "latest20") reviewLimit = 20;
  else if (windowType === "latest50") reviewLimit = 50;
  else if (windowType === "latest100") reviewLimit = 100;

  // Log incoming request
  console.log(`[API] /v1/reviews/overview called: platform=${platform}, type=${type}, windowType=${windowType}, bypassCache=${bypassCache}`);

  // Validate required params first
  if (!platform || typeof platform !== "string") {
    res.status(400).json({
      error: {
        code: "missing_parameter",
        message: "Missing required query parameter: platform"
      }
    });
    return;
  }

  if (!["flipkart", "myntra"].includes(platform as string)) {
    res.status(400).json({
      error: {
        code: "invalid_platform",
        message: `Invalid platform: ${platform}. Must be 'flipkart' or 'myntra'`
      }
    });
    return;
  }

  if (type !== "negative" && type !== "positive") {
    res.status(400).json({
      error: {
        code: "invalid_type",
        message: `Invalid type: ${type}. Must be 'negative' or 'positive'`
      }
    });
    return;
  }

  // Parse sort order (default: "default", no custom sort)
  const sortOrder = String(sortBy || "default") as "ratingAsc" | "ratingDesc" | "default";
  if (!["ratingAsc", "ratingDesc", "default"].includes(sortOrder)) {
    res.status(400).json({
      error: {
        code: "invalid_sort",
        message: `Invalid sortBy: ${sortBy}. Must be 'ratingAsc', 'ratingDesc', or 'default'`
      }
    });
    return;
  }

  let dateRange: { fromDate: string; toDate: string } | undefined;
  if (windowType === "custom") {
    const fromDate = req.query.customFromDate;
    const toDate = req.query.customToDate;

    if (!fromDate || !toDate) {
      res.status(400).json({
        error: {
          code: "missing_date_range",
          message: "Missing required parameters for custom window: customFromDate and customToDate"
        }
      });
      return;
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const fromDateStr = String(fromDate);
    const toDateStr = String(toDate);

    if (!dateRegex.test(fromDateStr)) {
      res.status(400).json({
        error: {
          code: "invalid_date_format",
          message: `Invalid customFromDate format: '${fromDateStr}'. Expected YYYY-MM-DD (e.g., 2026-05-20)`
        }
      });
      return;
    }

    if (!dateRegex.test(toDateStr)) {
      res.status(400).json({
        error: {
          code: "invalid_date_format",
          message: `Invalid customToDate format: '${toDateStr}'. Expected YYYY-MM-DD (e.g., 2026-05-20)`
        }
      });
      return;
    }

    // Validate that fromDate <= toDate
    if (fromDateStr > toDateStr) {
      res.status(400).json({
        error: {
          code: "invalid_date_range",
          message: `Invalid date range: fromDate (${fromDateStr}) must be before or equal to toDate (${toDateStr})`
        }
      });
      return;
    }

    dateRange = { fromDate: fromDateStr, toDate: toDateStr };
  }

  try {
    const result =
      type === "negative"
        ? await getProductsRankedByNegativeReviews(platform as Platform, pageSize, offset, reviewLimit, dateRange, sortOrder)
        : await getProductsRankedByPositiveReviews(platform as Platform, pageSize, offset, reviewLimit, dateRange, sortOrder);

    const totalPages = Math.ceil(result.total / pageSize);

    // Log response data
    console.log(`[API] Response: platform=${platform}, type=${type}, productCount=${result.products.length}, totalProducts=${result.total}`);
    if (result.products.length > 0) {
      console.log(`[API] First 3 products:`, result.products.slice(0, 3).map(p => ({
        id: p.sourceProductId,
        brand: p.brand,
        avgRating: p.averageRating,
      })));
    }

    res.json({
      products: result.products,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages,
      },
      reviewWindow: windowType,
      sortBy: sortOrder,
    });
  } catch (error) {
    console.error("[getReviewsOverview] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch products overview";
    res.status(500).json({
      error: {
        code: "internal_error",
        message: errorMessage
      }
    });
  }
}
