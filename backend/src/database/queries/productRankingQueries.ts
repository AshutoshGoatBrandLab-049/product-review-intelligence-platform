/**
 * Phase 10 — Product Ranking by Latest-10 Reviews
 *
 * Ranks products within a marketplace by the count of positive/negative reviews
 * in their latest 10 reviews.
 *
 * Flow:
 * 1. For each unique (platform, source_product_id) combination
 * 2. Get the 10 most recent reviews (by review_timestamp or review_date)
 * 3. Count how many have sentiment label = "positive" or "negative"
 * 4. Rank products by count (DESC)
 * 5. Return paginated results
 */

import { QueryTypes } from "sequelize";
import { appSequelize } from "../appStore/client.js";
import { config } from "../../config/index.js";
import type { Platform } from "../../types/unifiedReview.js";

export interface ProductRankingRow {
  sourceProductId: string;
  platform: Platform;
  rank: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  totalInLatestTen: number;
  averageRating: number;
}

/**
 * Get products ranked by negative review count in their latest 10 reviews.
 * Worst-first ranking: most bad reviews = rank 1
 * Uses getLatestNAverageRating to ensure consistent average_rating calculation.
 */
export async function getProductsRankedByNegativeReviews(
  platform: Platform,
  limit: number = 100,
  offset: number = 0,
): Promise<{ products: ProductRankingRow[]; total: number }> {
  const schema = config.appStore.schema;

  // Get all unique products for the platform
  const allProductsQuery = `
SELECT DISTINCT source_product_id
FROM "${schema}".normalized_reviews
WHERE platform = :platform
ORDER BY source_product_id
  `;

  const allProductsResult = (await appSequelize.query(allProductsQuery, {
    replacements: { platform },
    type: QueryTypes.SELECT,
  })) as Array<{ source_product_id: string }>;

  // For each product, get its latest-10 average rating
  const products: Array<{
    sourceProductId: string;
    platform: Platform;
    rank: number;
    positiveCount: number;
    negativeCount: number;
    neutralCount: number;
    totalInLatestTen: number;
    averageRating: number;
  }> = [];

  for (const row of allProductsResult) {
    const { averageRating, reviewCount } = await getLatestNAverageRating(platform, row.source_product_id, 10);
    products.push({
      sourceProductId: row.source_product_id,
      platform,
      rank: 0, // Will be set after sorting
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      totalInLatestTen: reviewCount,
      averageRating: averageRating ?? 0,
    });
  }

  // Sort by average rating ASC (negative ranking: worst first), source_product_id ASC
  products.sort((a, b) => {
    if (a.averageRating !== b.averageRating) {
      return a.averageRating - b.averageRating;
    }
    return a.sourceProductId.localeCompare(b.sourceProductId);
  });

  // Assign ranks
  products.forEach((p, i) => {
    p.rank = i + 1;
  });

  const total = products.length;
  const paginatedProducts = products.slice(offset, offset + limit);

  return {
    products: paginatedProducts,
    total,
  };
}

/**
 * Get products ranked by positive review count in their latest 10 reviews.
 * Best-first ranking: most good reviews = rank 1
 * Uses getLatestNAverageRating to ensure consistent average_rating calculation.
 */
export async function getProductsRankedByPositiveReviews(
  platform: Platform,
  limit: number = 100,
  offset: number = 0,
): Promise<{ products: ProductRankingRow[]; total: number }> {
  const schema = config.appStore.schema;

  // Get all unique products for the platform
  const allProductsQuery = `
SELECT DISTINCT source_product_id
FROM "${schema}".normalized_reviews
WHERE platform = :platform
ORDER BY source_product_id
  `;

  const allProductsResult = (await appSequelize.query(allProductsQuery, {
    replacements: { platform },
    type: QueryTypes.SELECT,
  })) as Array<{ source_product_id: string }>;

  // For each product, get its latest-10 average rating
  const products: Array<{
    sourceProductId: string;
    platform: Platform;
    rank: number;
    positiveCount: number;
    negativeCount: number;
    neutralCount: number;
    totalInLatestTen: number;
    averageRating: number;
  }> = [];

  for (const row of allProductsResult) {
    const { averageRating, reviewCount } = await getLatestNAverageRating(platform, row.source_product_id, 10);
    products.push({
      sourceProductId: row.source_product_id,
      platform,
      rank: 0, // Will be set after sorting
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      totalInLatestTen: reviewCount,
      averageRating: averageRating ?? 0,
    });
  }

  // Sort by average rating DESC, source_product_id ASC
  products.sort((a, b) => {
    if (b.averageRating !== a.averageRating) {
      return b.averageRating - a.averageRating;
    }
    return a.sourceProductId.localeCompare(b.sourceProductId);
  });

  // Assign ranks
  products.forEach((p, i) => {
    p.rank = i + 1;
  });

  const total = products.length;
  const paginatedProducts = products.slice(offset, offset + limit);

  return {
    products: paginatedProducts,
    total,
  };
}

/**
 * Get the average rating based on the latest N reviews for a product (N can be 10, 20, 30, 100, etc.).
 * Used by AI Analyst when answering questions specifically about "latest N reviews" average.
 * Returns null if product has no reviews.
 * Does NOT join with review_sentiment to avoid potential duplicate rows.
 */
export async function getLatestNAverageRating(
  platform: Platform,
  sourceProductId: string,
  limit: number = 10,
): Promise<{ averageRating: number | null; reviewCount: number }> {
  const schema = config.appStore.schema;

  const query = `
WITH latest_per_product AS (
  SELECT
    nr.source_product_id,
    nr.rating,
    ROW_NUMBER() OVER (
      PARTITION BY nr.source_product_id
      ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC
    ) as review_rank
  FROM "${schema}".normalized_reviews nr
  WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
),
latest_n AS (
  SELECT rating FROM latest_per_product
  WHERE review_rank <= :limit
)
SELECT
  COUNT(*) as total_reviews,
  CAST(AVG(rating)::numeric AS DECIMAL(10,2)) as average_rating
FROM latest_n
  `;

  const result = (await appSequelize.query(query, {
    replacements: { platform, sourceProductId, limit },
    type: QueryTypes.SELECT,
  })) as Array<{
    total_reviews: string;
    average_rating: number | null;
  }>;

  const row = result[0];
  if (!row) {
    return { averageRating: null, reviewCount: 0 };
  }

  return {
    averageRating: row.average_rating,
    reviewCount: Number(row.total_reviews),
  };
}
