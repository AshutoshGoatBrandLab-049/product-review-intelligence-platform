import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Transaction } from "sequelize";
import { appSequelize } from "../../../src/database/appStore/client.js";
import {
  detectSourceReplacement,
  cleanupStaleSourceData,
} from "../../../src/modules/ingestion/sourceReplacement.js";

describe("Source Replacement Detection & Cleanup", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("detectSourceReplacement() - Review ID Overlap Algorithm", () => {
    it("returns false when source is empty (startup/error)", async () => {
      vi.spyOn(appSequelize, "query").mockResolvedValueOnce({
        count: 0,
        maxId: 0,
      });

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(false);
    });

    it("returns false when canonical is empty (startup condition)", async () => {
      vi.spyOn(appSequelize, "query")
        .mockResolvedValueOnce({ count: 100, maxId: 100 }) // source
        .mockResolvedValueOnce({ count: 0, maxSourceRowId: 0 }); // canonical

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(false);
    });

    it("returns true when review_ids don't overlap AND source < 50% of canonical", async () => {
      // Scenario: 50 new rows, 500 canonical rows, zero review_id overlap
      // countRatio = 50/500 = 0.1 < 0.5 → REPLACEMENT
      vi.spyOn(appSequelize, "query")
        .mockResolvedValueOnce({ count: 50, maxId: 50 }) // source (plain: true returns object)
        .mockResolvedValueOnce({ count: 500, maxSourceRowId: 500 }) // canonical (plain: true returns object)
        .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object) (no plain: true, returns array)

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(true);
    });

    it("returns false when review_ids don't overlap BUT source exactly 150% of canonical", async () => {
      // Scenario: 1500 new rows, 1000 canonical rows, zero review_id overlap
      // countRatio = 1500/1000 = 1.5 (NOT > 1.5) → NOT replacement
      vi.spyOn(appSequelize, "query")
        .mockResolvedValueOnce({ count: 1500, maxId: 1500 }) // source
        .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
        .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(false); // 1.5 is NOT > 1.5
    });

    it("returns false when review_ids overlap (normal incremental)", async () => {
      // Scenario: some old review_ids still exist in source → incremental
      // Even with high count ratio, overlap means it's not a replacement
      vi.spyOn(appSequelize, "query")
        .mockResolvedValueOnce({ count: 100, maxId: 1000 }) // source
        .mockResolvedValueOnce({ count: 500, maxSourceRowId: 500 }) // canonical
        .mockResolvedValueOnce({ overlapCount: 45 }); // review_ids overlap (plain: true returns object)

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(false); // Overlap exists → not replacement
    });

    it("returns false when no overlap but count ratio is similar (~1.0x)", async () => {
      // Scenario: 1000 new rows, 1000 canonical rows, no overlap
      // countRatio = 1.0 (not < 0.5 and not > 1.5) → NOT replacement
      // Conservative: might be coincidental, don't delete
      vi.spyOn(appSequelize, "query")
        .mockResolvedValueOnce({ count: 1000, maxId: 1000 }) // source
        .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
        .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(false);
    });

    it("handles flipkart platform (marketplace-agnostic)", async () => {
      vi.spyOn(appSequelize, "query")
        .mockResolvedValueOnce({ count: 50, maxId: 50 }) // source
        .mockResolvedValueOnce({ count: 500, maxSourceRowId: 500 }) // canonical
        .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

      const result = await detectSourceReplacement("flipkart");
      expect(result).toBe(true);
    });

    it("conservatively handles errors by returning false", async () => {
      vi.spyOn(appSequelize, "query").mockRejectedValueOnce(
        new Error("Database error"),
      );

      const result = await detectSourceReplacement("myntra");
      expect(result).toBe(false); // Safe default
    });

    describe("Edge Cases", () => {
      it("handles very small source (1 row) with no overlap", async () => {
        vi.spyOn(appSequelize, "query")
          .mockResolvedValueOnce({ count: 1, maxId: 1 }) // source
          .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
          .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

        const result = await detectSourceReplacement("myntra");
        expect(result).toBe(true);
      });

      it("handles exactly 50% ratio with no overlap (below threshold)", async () => {
        // source: 500, canonical: 1000, ratio = 0.5 (NOT < 0.5) → NOT replacement
        vi.spyOn(appSequelize, "query")
          .mockResolvedValueOnce({ count: 500, maxId: 500 }) // source
          .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
          .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

        const result = await detectSourceReplacement("myntra");
        expect(result).toBe(false); // 0.5 is NOT < 0.5
      });

      it("handles 49.9% ratio with no overlap (above threshold)", async () => {
        // source: 499, canonical: 1000, ratio = 0.499 < 0.5 → REPLACEMENT
        vi.spyOn(appSequelize, "query")
          .mockResolvedValueOnce({ count: 499, maxId: 499 }) // source
          .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
          .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

        const result = await detectSourceReplacement("myntra");
        expect(result).toBe(true);
      });

      it("handles exactly 150% ratio with no overlap (at threshold)", async () => {
        // source: 1500, canonical: 1000, ratio = 1.5 (NOT > 1.5) → NOT replacement
        vi.spyOn(appSequelize, "query")
          .mockResolvedValueOnce({ count: 1500, maxId: 1500 }) // source
          .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
          .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

        const result = await detectSourceReplacement("myntra");
        expect(result).toBe(false); // 1.5 is NOT > 1.5
      });

      it("handles 150.1% ratio with no overlap (above threshold)", async () => {
        // source: 1501, canonical: 1000, ratio = 1.501 > 1.5 → REPLACEMENT
        vi.spyOn(appSequelize, "query")
          .mockResolvedValueOnce({ count: 1501, maxId: 1501 }) // source
          .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
          .mockResolvedValueOnce({ overlapCount: 0 }); // review_id overlap (plain: true returns object)

        const result = await detectSourceReplacement("myntra");
        expect(result).toBe(true);
      });

      it("handles high ratio with overlap (not replacement)", async () => {
        // source: 2000, canonical: 1000, ratio = 2.0 > 1.5
        // BUT overlap exists → normal incremental
        vi.spyOn(appSequelize, "query")
          .mockResolvedValueOnce({ count: 2000, maxId: 2000 }) // source
          .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
          .mockResolvedValueOnce({ overlapCount: 500 }); // review_ids overlap (plain: true returns object)

        const result = await detectSourceReplacement("myntra");
        expect(result).toBe(false); // Overlap exists → not replacement
      });

      it("is idempotent - same result on repeated calls", async () => {
        const mockQuery = vi.spyOn(appSequelize, "query");
        mockQuery
          .mockResolvedValueOnce({ count: 50, maxId: 50 }) // call 1: source
          .mockResolvedValueOnce({ count: 500, maxSourceRowId: 500 }) // call 2: canonical
          .mockResolvedValueOnce({ overlapCount: 0 }) // call 3: overlap (plain: true)
          .mockResolvedValueOnce({ count: 50, maxId: 50 }) // call 4: source
          .mockResolvedValueOnce({ count: 500, maxSourceRowId: 500 }) // call 5: canonical
          .mockResolvedValueOnce({ overlapCount: 0 }); // call 6: overlap (plain: true)

        const result1 = await detectSourceReplacement("myntra");
        const result2 = await detectSourceReplacement("myntra");

        expect(result1).toBe(true);
        expect(result2).toBe(true);
      });
    });
  });

  describe("cleanupStaleSourceData()", () => {
    let mockTransaction: Partial<Transaction>;

    beforeEach(() => {
      mockTransaction = {};
    });

    it("deletes normalized_reviews for deleted reviews", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      // Mock return values for each query in cleanupStaleSourceData
      mockQueryFn
        .mockResolvedValueOnce([
          {
            canonicalReviewId: "rev1",
            sourceProductId: "prod1",
          },
          {
            canonicalReviewId: "rev2",
            sourceProductId: "prod1",
          },
        ]) // 1. Query: stale reviews
        .mockResolvedValueOnce(undefined) // 2. Delete: identity_anomalies batch
        .mockResolvedValueOnce(undefined) // 3. Delete: review_sentiment batch
        .mockResolvedValueOnce(undefined) // 4. Delete: review_theme batch
        .mockResolvedValueOnce(undefined) // 5. Delete: normalized_reviews batch
        .mockResolvedValueOnce([]) // 6. Query: stale products (empty)
        .mockResolvedValueOnce({ count: 0 }) // 7. Query: stale metrics count
        .mockResolvedValueOnce([]); // 8. Query: affected products

      const result = await cleanupStaleSourceData(
        "myntra",
        mockTransaction as Transaction,
      );

      expect(result.staleReviewsDeleted).toBe(2);
      expect(result.staleProductsDeleted).toBe(0);
      expect(result.staleMetricsDeleted).toBe(0);
    });

    it("deletes product_dimension for products with no reviews", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      mockQueryFn
        .mockResolvedValueOnce([]) // stale reviews
        .mockResolvedValueOnce([
          { sourceProductId: "prod1" },
          { sourceProductId: "prod2" },
        ]) // stale products
        .mockResolvedValueOnce(undefined) // delete products
        .mockResolvedValueOnce([{ count: 0 }]) // stale metrics count
        .mockResolvedValueOnce([]); // affected products

      const result = await cleanupStaleSourceData(
        "myntra",
        mockTransaction as Transaction,
      );

      expect(result.staleProductsDeleted).toBe(2);
    });

    it("deletes product_daily_metrics for deleted review dates", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      mockQueryFn
        .mockResolvedValueOnce([]) // stale reviews
        .mockResolvedValueOnce([]) // stale products
        .mockResolvedValueOnce([{ count: 150 }]) // stale metrics count
        .mockResolvedValueOnce(undefined) // delete metrics
        .mockResolvedValueOnce([]); // affected products

      const result = await cleanupStaleSourceData(
        "myntra",
        mockTransaction as Transaction,
      );

      expect(result.staleMetricsDeleted).toBe(150);
    });

    it("identifies affected products correctly", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      mockQueryFn
        .mockResolvedValueOnce([]) // stale reviews
        .mockResolvedValueOnce([]) // stale products
        .mockResolvedValueOnce([{ count: 0 }]) // stale metrics count
        .mockResolvedValueOnce([
          { platform: "myntra", sourceProductId: "prod1" },
          { platform: "myntra", sourceProductId: "prod2" },
          { platform: "myntra", sourceProductId: "prod3" },
        ]); // affected products

      const result = await cleanupStaleSourceData(
        "myntra",
        mockTransaction as Transaction,
      );

      expect(result.affectedProducts).toHaveLength(3);
      expect(result.affectedProducts[0].sourceProductId).toBe("prod1");
      expect(result.affectedProducts[1].sourceProductId).toBe("prod2");
      expect(result.affectedProducts[2].sourceProductId).toBe("prod3");
    });

    it("returns correct result structure", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      mockQueryFn
        .mockResolvedValueOnce([]) // stale reviews
        .mockResolvedValueOnce([]) // stale products
        .mockResolvedValueOnce([{ count: 0 }]) // stale metrics count
        .mockResolvedValueOnce([]); // affected products

      const result = await cleanupStaleSourceData(
        "myntra",
        mockTransaction as Transaction,
      );

      expect(result).toHaveProperty("staleReviewsDeleted");
      expect(result).toHaveProperty("staleProductsDeleted");
      expect(result).toHaveProperty("staleMetricsDeleted");
      expect(result).toHaveProperty("affectedProducts");
      expect(result.affectedProducts).toBeInstanceOf(Array);
    });

    it("handles large batch deletions (>1000 reviews)", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");
      const largeReviewList = Array.from({ length: 2500 }, (_, i) => ({
        canonicalReviewId: `rev${i}`,
        sourceProductId: "prod1",
      }));

      mockQueryFn
        // Query: stale reviews
        .mockResolvedValueOnce(largeReviewList)
        // Batch 1: delete identity_anomalies, review_sentiment, review_theme, normalized_reviews
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        // Batch 2: delete identity_anomalies, review_sentiment, review_theme, normalized_reviews
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        // Batch 3: delete identity_anomalies, review_sentiment, review_theme, normalized_reviews
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        // Query: stale products (empty)
        .mockResolvedValueOnce([])
        // Query: stale metrics count
        .mockResolvedValueOnce({ count: 0 })
        // Query: affected products
        .mockResolvedValueOnce([]);

      const result = await cleanupStaleSourceData(
        "myntra",
        mockTransaction as Transaction,
      );

      expect(result.staleReviewsDeleted).toBe(2500);
      // Verify batching: 2500 / 1000 = 3 batches
      // Queries: 1 stale + (3 batches × 4 deletes) + 1 products + 1 metrics + 1 affected = 16 total
      expect(mockQueryFn).toHaveBeenCalledTimes(16);
    });

    it("handles flipkart platform", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      mockQueryFn
        .mockResolvedValueOnce([]) // stale reviews
        .mockResolvedValueOnce([]) // stale products
        .mockResolvedValueOnce([{ count: 0 }]) // stale metrics count
        .mockResolvedValueOnce([]); // affected products

      const result = await cleanupStaleSourceData(
        "flipkart",
        mockTransaction as Transaction,
      );

      expect(result).toBeDefined();
      expect(result.staleReviewsDeleted).toBe(0);
      expect(result.affectedProducts).toBeInstanceOf(Array);
    });

    it("parametrizes platform correctly in all queries", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      mockQueryFn
        .mockResolvedValueOnce([]) // stale reviews
        .mockResolvedValueOnce([]) // stale products
        .mockResolvedValueOnce([{ count: 0 }]) // stale metrics count
        .mockResolvedValueOnce([]); // affected products

      await cleanupStaleSourceData("myntra", mockTransaction as Transaction);

      // Verify all query calls include platform parameter
      const queryCalls = mockQueryFn.mock.calls;
      queryCalls.forEach((call) => {
        const options = call[1] as any;
        if (options?.bind) {
          // First bind parameter should be platform
          expect(options.bind[0]).toBe("myntra");
        }
      });
    });

    it("throws error on database failure to trigger rollback", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");
      mockQueryFn.mockRejectedValueOnce(new Error("Database error"));

      await expect(
        cleanupStaleSourceData("myntra", mockTransaction as Transaction),
      ).rejects.toThrow("Database error");
    });
  });

  describe("Integration: Detection + Cleanup", () => {
    it("full replacement workflow", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      // Detection queries (3 queries)
      mockQueryFn
        .mockResolvedValueOnce({ count: 50, maxId: 50 }) // source count
        .mockResolvedValueOnce({ count: 500, maxSourceRowId: 500 }) // canonical count
        .mockResolvedValueOnce({ overlapCount: 0 }) // review_id overlap (plain: true)
        // Cleanup queries
        .mockResolvedValueOnce([
          { canonicalReviewId: "rev1", sourceProductId: "prod1" },
        ]) // stale reviews query
        .mockResolvedValueOnce(undefined) // delete identity_anomalies
        .mockResolvedValueOnce(undefined) // delete review_sentiment
        .mockResolvedValueOnce(undefined) // delete review_theme
        .mockResolvedValueOnce(undefined) // delete normalized_reviews
        .mockResolvedValueOnce([{ sourceProductId: "prod1" }]) // stale products query
        .mockResolvedValueOnce(undefined) // delete stale products
        .mockResolvedValueOnce([{ count: 5 }]) // stale metrics count query
        .mockResolvedValueOnce(undefined) // delete stale metrics
        .mockResolvedValueOnce([
          { platform: "myntra", sourceProductId: "prod2" },
        ]); // affected products query

      const isReplacement = await detectSourceReplacement("myntra");
      expect(isReplacement).toBe(true);

      const mockTransaction = {} as Transaction;
      const cleanup = await cleanupStaleSourceData("myntra", mockTransaction);

      expect(cleanup.staleReviewsDeleted).toBe(1);
      expect(cleanup.staleProductsDeleted).toBe(1);
      expect(cleanup.staleMetricsDeleted).toBe(5);
      expect(cleanup.affectedProducts).toHaveLength(1);
    });

    it("handles no-replacement scenario", async () => {
      const mockQueryFn = vi.spyOn(appSequelize, "query");

      // Detection: returns false (no replacement)
      // Source and canonical counts are similar with overlap
      mockQueryFn
        .mockResolvedValueOnce({ count: 500, maxId: 500 }) // source
        .mockResolvedValueOnce({ count: 600, maxSourceRowId: 600 }) // canonical
        .mockResolvedValueOnce({ overlapCount: 400 }); // significant overlap (plain: true)

      const isReplacement = await detectSourceReplacement("myntra");
      expect(isReplacement).toBe(false);

      // Cleanup should not be called
      expect(mockQueryFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("Platform Compatibility", () => {
    const platforms: ["flipkart", "myntra"] = ["flipkart", "myntra"];

    platforms.forEach((platform) => {
      describe(`${platform} platform`, () => {
        it("detection works", async () => {
          const mockQueryFn = vi.spyOn(appSequelize, "query");
          mockQueryFn
            .mockResolvedValueOnce({ count: 100, maxId: 100 }) // source
            .mockResolvedValueOnce({ count: 1000, maxSourceRowId: 1000 }) // canonical
            .mockResolvedValueOnce([{ overlapCount: 50 }]); // review_id overlap

          const result = await detectSourceReplacement(platform);
          expect(typeof result).toBe("boolean");
        });

        it("cleanup works", async () => {
          const mockQueryFn = vi.spyOn(appSequelize, "query");
          mockQueryFn
            .mockResolvedValueOnce([]) // stale reviews
            .mockResolvedValueOnce([]) // stale products
            .mockResolvedValueOnce([{ count: 0 }]) // stale metrics count
            .mockResolvedValueOnce([]); // affected products

          const mockTransaction = {} as Transaction;
          const result = await cleanupStaleSourceData(
            platform,
            mockTransaction,
          );

          expect(result).toHaveProperty("staleReviewsDeleted");
          expect(result).toHaveProperty("staleProductsDeleted");
          expect(result).toHaveProperty("staleMetricsDeleted");
          expect(result).toHaveProperty("affectedProducts");
        });
      });
    });
  });
});
