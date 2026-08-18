import { describe, it, expect, beforeEach } from "vitest";
import {
  analyzeReviewBatch,
  aggregateSemanticAspects,
  validateAspectCounts,
  analyzeProductReviewsForIntent,
} from "../../src/modules/ai/semanticAnalysis.js";
import type { ReviewWithText } from "../../src/modules/ai/types.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { AnalyticalIntent } from "../../src/modules/ai/intentDetection.js";

describe("Semantic Analysis", () => {
  let mockProvider: MockAiProvider;

  beforeEach(() => {
    mockProvider = new MockAiProvider();
  });

  describe("analyzeReviewBatch", () => {
    it("should analyze a batch of reviews", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Material quality is poor and sizing is wrong",
          title: "Not satisfied",
        },
        {
          canonical_review_id: "review-2",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 5,
          review_text: "Excellent product, great quality",
          title: "Love it",
        },
      ];

      const results = await analyzeReviewBatch(reviews, mockProvider);

      expect(results).toHaveLength(2);
      expect(results[0]?.canonicalReviewId).toBe("review-1");
      expect(results[0]?.observations).toBeDefined();
      expect(results[1]?.canonicalReviewId).toBe("review-2");
    });

    it("should skip reviews with null or empty review_text", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: null,
          title: "Empty review",
        },
      ];

      const results = await analyzeReviewBatch(reviews, mockProvider);

      expect(results).toHaveLength(0);
    });

    it("should handle whitespace-only review_text as empty", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "   ",
          title: "Whitespace only",
        },
      ];

      const results = await analyzeReviewBatch(reviews, mockProvider);

      expect(results).toHaveLength(0);
    });
  });

  describe("aggregateSemanticAspects", () => {
    it("should count unique reviews per aspect", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Material is bad and sizing is wrong",
          title: "Bad",
        },
      ];

      const analyses = await analyzeReviewBatch(reviews, mockProvider);
      const aspects = aggregateSemanticAspects(analyses, 1);

      // Mock provider returns one quality_issue per review
      expect(aspects.length).toBeGreaterThan(0);
      // Each aspect should have count matching unique review IDs
      for (const aspect of aspects) {
        expect(aspect.count).toBeLessThanOrEqual(1);
        expect(aspect.reviewIds).toContain("review-1");
      }
    });

    it("should not count same review twice for multiple aspects", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Material bad and sizing bad",
          title: "Bad",
        },
      ];

      const analyses = await analyzeReviewBatch(reviews, mockProvider);
      const aspects = aggregateSemanticAspects(analyses, 1);

      // Total mentions across all aspects should not exceed unique reviews
      const totalMentions = aspects.reduce((sum, a) => sum + a.reviewIds.length, 0);
      expect(totalMentions).toBeLessThanOrEqual(1);
    });

    it("should handle aspect-level sentiment correctly", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 3,
          review_text: "Design is beautiful but quality is poor",
          title: "Mixed",
        },
      ];

      const analyses = await analyzeReviewBatch(reviews, mockProvider);
      const aspects = aggregateSemanticAspects(analyses, 1);

      // Aspects should have sentiments array
      for (const aspect of aspects) {
        expect(aspect.sentiments).toBeDefined();
        expect(Array.isArray(aspect.sentiments)).toBe(true);
      }
    });

    it("should calculate percentages correctly", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Bad quality",
          title: "Bad",
        },
        {
          canonical_review_id: "review-2",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Bad quality",
          title: "Bad",
        },
      ];

      const analyses = await analyzeReviewBatch(reviews, mockProvider);
      const aspects = aggregateSemanticAspects(analyses, 2);

      for (const aspect of aspects) {
        expect(aspect.percentage).toBeLessThanOrEqual(100);
        expect(aspect.percentage).toBeGreaterThanOrEqual(0);
      }
    });

    it("should mark aspects with conflicting sentiment", async () => {
      const analyses = [
        {
          canonicalReviewId: "review-1",
          platform: "flipkart",
          sourceProductId: "PROD001",
          observations: [
            {
              aspect: "quality",
              sentiment: "positive" as const,
              textSnippet: "good quality",
              confidence: 0.9,
              sourceModel: "mock",
            },
            {
              aspect: "quality",
              sentiment: "negative" as const,
              textSnippet: "poor quality",
              confidence: 0.8,
              sourceModel: "mock",
            },
          ],
          analyzedAt: new Date(),
        },
      ];

      const aspects = aggregateSemanticAspects(analyses, 1);
      const qualityAspect = aspects.find((a) => a.aspect === "quality");

      expect(qualityAspect?.hasConflictingSentiment).toBe(true);
    });
  });

  describe("validateAspectCounts", () => {
    it("should validate correct aspect counts", () => {
      const aspects = [
        {
          aspect: "quality",
          count: 3,
          percentage: 30,
          reviewIds: ["id1", "id2", "id3"],
          sentiments: [{ sentiment: "negative" as const, count: 3 }],
        },
      ];

      const result = validateAspectCounts(aspects, 10);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject duplicate review IDs in same aspect", () => {
      const aspects = [
        {
          aspect: "quality",
          count: 2,
          percentage: 20,
          reviewIds: ["id1", "id1"], // Duplicate!
          sentiments: [{ sentiment: "negative" as const, count: 2 }],
        },
      ];

      const result = validateAspectCounts(aspects, 10);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("should reject count mismatches", () => {
      const aspects = [
        {
          aspect: "quality",
          count: 3, // Claims 3
          percentage: 30,
          reviewIds: ["id1", "id2"], // But only 2 IDs!
          sentiments: [{ sentiment: "negative" as const, count: 3 }],
        },
      ];

      const result = validateAspectCounts(aspects, 10);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("count"))).toBe(true);
    });

    it("should reject counts exceeding total", () => {
      const aspects = [
        {
          aspect: "quality",
          count: 15, // More than total 10!
          percentage: 150,
          reviewIds: Array.from({ length: 15 }, (_, i) => `id${i}`),
          sentiments: [{ sentiment: "negative" as const, count: 15 }],
        },
      ];

      const result = validateAspectCounts(aspects, 10);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("exceeds total"))).toBe(true);
    });

    it("should reject mismatched sentiment counts", () => {
      const aspects = [
        {
          aspect: "quality",
          count: 5, // 5 reviews total
          percentage: 50,
          reviewIds: ["id1", "id2", "id3", "id4", "id5"],
          sentiments: [
            { sentiment: "negative" as const, count: 3 },
            { sentiment: "positive" as const, count: 1 }, // Should sum to 5, not 4
          ],
        },
      ];

      const result = validateAspectCounts(aspects, 10);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("sentiment counts"))).toBe(true);
    });
  });

  describe("analyzeProductReviewsForIntent", () => {
    it("should skip analysis for REVIEW_EXPLORATION intent", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Poor quality",
          title: "Bad",
        },
      ];

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.REVIEW_EXPLORATION, mockProvider);

      expect(result.aspects).toHaveLength(0);
      expect(result.metadata.reviewsAnalyzed).toBe(0);
    });

    it("should skip analysis for STATS_QUERY intent", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Poor quality",
          title: "Bad",
        },
      ];

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.STATS_QUERY, mockProvider);

      expect(result.aspects).toHaveLength(0);
      expect(result.metadata.reviewsAnalyzed).toBe(0);
    });

    it("should analyze for TOP_PROBLEM intent", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Quality issue",
          title: "Bad",
        },
      ];

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.TOP_PROBLEM, mockProvider);

      expect(result.metadata.reviewsAnalyzed).toBeGreaterThan(0);
    });

    it("should filter negative aspects only for TOP_PROBLEM", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Quality issue",
          title: "Bad",
        },
      ];

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.TOP_PROBLEM, mockProvider);

      // All aspects should have negative sentiment
      for (const aspect of result.aspects) {
        const hasNegative = aspect.sentiments.some((s) => s.sentiment === "negative");
        expect(hasNegative).toBe(true);
      }
    });

    it("should filter positive aspects only for POSITIVE_FEEDBACK", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 5,
          review_text: "Great product",
          title: "Love it",
        },
      ];

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.POSITIVE_FEEDBACK, mockProvider);

      // All aspects should have positive sentiment
      for (const aspect of result.aspects) {
        const hasPositive = aspect.sentiments.some((s) => s.sentiment === "positive");
        expect(hasPositive).toBe(true);
      }
    });

    it("should respect budget limit", async () => {
      const reviews: ReviewWithText[] = Array.from({ length: 100 }, (_, i) => ({
        canonical_review_id: `review-${i}`,
        platform: "flipkart",
        source_product_id: "PROD001",
        rating: 2,
        review_text: "Quality issue",
        title: "Bad",
      }));

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.TOP_PROBLEM, mockProvider, 20);

      expect(result.metadata.reviewsAnalyzed).toBeLessThanOrEqual(20);
    });

    it("should report null text reviews", async () => {
      const reviews: ReviewWithText[] = [
        {
          canonical_review_id: "review-1",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: null,
          title: "No text",
        },
        {
          canonical_review_id: "review-2",
          platform: "flipkart",
          source_product_id: "PROD001",
          rating: 2,
          review_text: "Quality issue",
          title: "Bad",
        },
      ];

      const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.TOP_PROBLEM, mockProvider);

      expect(result.metadata.reviewsWithNullText).toBe(1);
    });
  });
});
