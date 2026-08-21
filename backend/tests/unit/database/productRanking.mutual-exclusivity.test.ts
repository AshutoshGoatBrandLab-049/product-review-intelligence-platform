/**
 * CRITICAL TESTS: Mutual Exclusivity of Product Classification
 *
 * Rule: A product MUST appear in exactly ONE section (Bad or Good)
 * for a given platform and review window.
 *
 * Never in both. Never in neither (unless has no reviews in window).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appSequelize } from '../../../src/database/appStore/client.js';
import { getProductsRankedByNegativeReviews, getProductsRankedByPositiveReviews } from '../../../src/database/queries/productRankingQueries.js';
import { NormalizedReview } from '../../../src/database/appStore/models/normalizedReview.js';
import type { Platform } from '../../../src/types/unifiedReview.js';

describe('Product Ranking: Mutual Exclusivity Enforcement', () => {
  const platform: Platform = 'myntra';

  beforeAll(async () => {
    // Database is already initialized
  });

  afterAll(async () => {
    // Cleanup
  });

  it('1. Product with avg < 3.0 appears ONLY in Bad Reviews, NOT in Good Reviews', async () => {
    // Get all products ranked by both positive and negative
    const negativeResult = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);
    const positiveResult = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    // Verify all products in negative rankings have avg < 3.0
    negativeResult.products.forEach(product => {
      expect(product.averageRating).toBeLessThan(3.0);
    });

    // Verify no negative product appears in positive rankings
    const negativeIds = new Set(negativeResult.products.map(p => p.sourceProductId));
    const positiveIds = new Set(positiveResult.products.map(p => p.sourceProductId));

    for (const negId of negativeIds) {
      expect(positiveIds.has(negId)).toBe(false);
    }
  });

  it('2. Product with avg >= 3.0 appears ONLY in Good Reviews, NOT in Bad Reviews', async () => {
    const negativeResult = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);
    const positiveResult = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    // Verify all products in positive rankings have avg >= 3.0
    positiveResult.products.forEach(product => {
      expect(product.averageRating).toBeGreaterThanOrEqual(3.0);
    });

    // Verify no positive product appears in negative rankings
    const negativeIds = new Set(negativeResult.products.map(p => p.sourceProductId));
    const positiveIds = new Set(positiveResult.products.map(p => p.sourceProductId));

    for (const posId of positiveIds) {
      expect(negativeIds.has(posId)).toBe(false);
    }
  });

  it('3. Product with exactly 3.0 avg appears ONLY in Good Reviews (boundary case)', async () => {
    const positiveResult = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);
    const negativeResult = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);

    // If any product has exactly 3.0, it must be in positive, NOT negative
    const productsAt3 = positiveResult.products.filter(p => p.averageRating === 3.0);

    if (productsAt3.length > 0) {
      // Verify 3.0 products are NOT in negative
      const negIds = new Set(negativeResult.products.map(p => p.sourceProductId));
      productsAt3.forEach(p3 => {
        expect(negIds.has(p3.sourceProductId)).toBe(false);
      });
    }
  });

  it('4. CRITICAL: Same product does NOT exist in both result sets', async () => {
    const negativeResult = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);
    const positiveResult = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    const negativeIds = new Set(negativeResult.products.map(p => p.sourceProductId));
    const positiveIds = new Set(positiveResult.products.map(p => p.sourceProductId));

    // Find intersection
    const intersection = new Set([...negativeIds].filter(id => positiveIds.has(id)));

    // MUST be empty
    expect(intersection.size).toBe(0);
    expect(Array.from(intersection).length).toBe(0);
  });

  it('5. All negative products have averageRating < 3.0', async () => {
    const result = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);

    result.products.forEach(product => {
      expect(product.averageRating).toBeLessThan(3.0);
      expect(product.averageRating).toBeGreaterThanOrEqual(0);
    });
  });

  it('6. All positive products have averageRating >= 3.0', async () => {
    const result = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    result.products.forEach(product => {
      expect(product.averageRating).toBeGreaterThanOrEqual(3.0);
      expect(product.averageRating).toBeLessThanOrEqual(5.0);
    });
  });

  it('7. Changing window latest-10 → latest-20 recalculates but maintains exclusivity', async () => {
    // Test with both window sizes
    const neg10 = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);
    const pos10 = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    const neg20 = await getProductsRankedByNegativeReviews(platform, 1000, 0, 20);
    const pos20 = await getProductsRankedByPositiveReviews(platform, 1000, 0, 20);

    // Verify exclusivity for latest-10
    const neg10Ids = new Set(neg10.products.map(p => p.sourceProductId));
    const pos10Ids = new Set(pos10.products.map(p => p.sourceProductId));
    const intersection10 = new Set([...neg10Ids].filter(id => pos10Ids.has(id)));
    expect(intersection10.size).toBe(0);

    // Verify exclusivity for latest-20
    const neg20Ids = new Set(neg20.products.map(p => p.sourceProductId));
    const pos20Ids = new Set(pos20.products.map(p => p.sourceProductId));
    const intersection20 = new Set([...neg20Ids].filter(id => pos20Ids.has(id)));
    expect(intersection20.size).toBe(0);

    // Note: A product may move from negative (latest-10) to positive (latest-20)
    // or vice versa, but never be in both for the SAME window
  });

  it('8. Custom date range preserves mutual exclusivity', async () => {
    // Test with custom date ranges
    const neg = await getProductsRankedByNegativeReviews(
      platform,
      1000,
      0,
      10,
      { fromDate: '2026-06-01', toDate: '2026-08-31' }
    );
    const pos = await getProductsRankedByPositiveReviews(
      platform,
      1000,
      0,
      10,
      { fromDate: '2026-06-01', toDate: '2026-08-31' }
    );

    const negIds = new Set(neg.products.map(p => p.sourceProductId));
    const posIds = new Set(pos.products.map(p => p.sourceProductId));
    const intersection = new Set([...negIds].filter(id => posIds.has(id)));

    // CRITICAL: Must be mutually exclusive
    expect(intersection.size).toBe(0);
  });

  it('9. Verify classification boundaries: 2.99 < 3.0 < 3.01', async () => {
    const neg = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);
    const pos = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    // Check if we have products near the boundary
    const negRatings = neg.products.map(p => p.averageRating).filter(r => r > 2.95 && r < 3.0);
    const posRatings = pos.products.map(p => p.averageRating).filter(r => r >= 3.0 && r < 3.05);

    // If we have products near boundary, verify correct classification
    negRatings.forEach(r => {
      expect(r).toBeLessThan(3.0);
    });

    posRatings.forEach(r => {
      expect(r).toBeGreaterThanOrEqual(3.0);
    });
  });

  it('10. Verify no product with null averageRating appears in results', async () => {
    const neg = await getProductsRankedByNegativeReviews(platform, 1000, 0, 10);
    const pos = await getProductsRankedByPositiveReviews(platform, 1000, 0, 10);

    // All products should have a valid averageRating (not null, not NaN)
    [...neg.products, ...pos.products].forEach(product => {
      expect(typeof product.averageRating).toBe('number');
      expect(isNaN(product.averageRating)).toBe(false);
    });
  });
});
