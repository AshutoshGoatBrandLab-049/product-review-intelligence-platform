/**
 * Test custom date range functionality in reviews overview endpoint
 */

import { describe, it, expect } from 'vitest';
import { getProductsRankedByNegativeReviews, getProductsRankedByPositiveReviews } from '../../../src/database/queries/productRankingQueries.js';
import type { Platform } from '../../../src/types/unifiedReview.js';

describe('Custom Date Range - Reviews Overview', () => {
  const platform: Platform = 'myntra';

  it('should accept valid date range in YYYY-MM-DD format', async () => {
    // Valid date range format
    const dateRange = {
      fromDate: '2026-06-01',
      toDate: '2026-08-31',
    };

    // Should not throw
    const result = await getProductsRankedByPositiveReviews(
      platform,
      100,
      0,
      10,
      dateRange
    );

    expect(result).toBeDefined();
    expect(Array.isArray(result.products)).toBe(true);
  });

  it('should accept different date ranges', async () => {
    const ranges = [
      { fromDate: '2026-01-01', toDate: '2026-01-31' },
      { fromDate: '2026-05-01', toDate: '2026-05-31' },
      { fromDate: '2026-08-01', toDate: '2026-08-31' },
    ];

    for (const dateRange of ranges) {
      const result = await getProductsRankedByNegativeReviews(
        platform,
        100,
        0,
        10,
        dateRange
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.products)).toBe(true);
    }
  });

  it('should work with sortBy parameter', async () => {
    const dateRange = {
      fromDate: '2026-06-01',
      toDate: '2026-08-31',
    };

    const resultDefault = await getProductsRankedByPositiveReviews(
      platform,
      10,
      0,
      10,
      dateRange,
      'default'
    );

    const resultAsc = await getProductsRankedByPositiveReviews(
      platform,
      10,
      0,
      10,
      dateRange,
      'ratingAsc'
    );

    const resultDesc = await getProductsRankedByPositiveReviews(
      platform,
      10,
      0,
      10,
      dateRange,
      'ratingDesc'
    );

    expect(resultDefault).toBeDefined();
    expect(resultAsc).toBeDefined();
    expect(resultDesc).toBeDefined();
  });

  it('should return products with correct classification in date range', async () => {
    const dateRange = {
      fromDate: '2026-06-01',
      toDate: '2026-08-31',
    };

    const negativeResult = await getProductsRankedByNegativeReviews(
      platform,
      100,
      0,
      10,
      dateRange
    );

    const positiveResult = await getProductsRankedByPositiveReviews(
      platform,
      100,
      0,
      10,
      dateRange
    );

    // All negative products must have avg < 3.0
    negativeResult.products.forEach(p => {
      expect(p.averageRating).toBeLessThan(3.0);
    });

    // All positive products must have avg >= 3.0
    positiveResult.products.forEach(p => {
      expect(p.averageRating).toBeGreaterThanOrEqual(3.0);
    });

    // No overlap between sets
    const negIds = new Set(negativeResult.products.map(p => p.sourceProductId));
    const posIds = new Set(positiveResult.products.map(p => p.sourceProductId));
    const intersection = new Set([...negIds].filter(id => posIds.has(id)));

    expect(intersection.size).toBe(0);
  });

  it('should maintain mutual exclusivity with different date ranges', async () => {
    const ranges = [
      { fromDate: '2026-01-01', toDate: '2026-03-31' },
      { fromDate: '2026-04-01', toDate: '2026-06-30' },
      { fromDate: '2026-07-01', toDate: '2026-08-31' },
    ];

    for (const dateRange of ranges) {
      const negResult = await getProductsRankedByNegativeReviews(
        platform,
        1000,
        0,
        10,
        dateRange
      );

      const posResult = await getProductsRankedByPositiveReviews(
        platform,
        1000,
        0,
        10,
        dateRange
      );

      // Verify mutual exclusivity
      const negIds = new Set(negResult.products.map(p => p.sourceProductId));
      const posIds = new Set(posResult.products.map(p => p.sourceProductId));
      const intersection = new Set([...negIds].filter(id => posIds.has(id)));

      expect(intersection.size).toBe(0);
    }
  });
});
