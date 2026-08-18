/**
 * Phase 10 Step 3 — Semantic Analysis from review text.
 * Extracts customer-voiced aspects (not limited to review_theme vocabulary),
 * assigns aspect-level sentiment, and counts deterministically.
 */

import type { AnalyticalIntent } from "./intentDetection.js";
import type { AiProvider } from "./providers/aiProvider.js";
import type {
  ReviewSemanticAnalysis,
  SemanticAspectObservation,
  SemanticAspectData,
  AspectSentiment,
  ReviewWithText,
} from "./types.js";
import { config } from "../../config/index.js";

/**
 * Analyzes a batch of reviews for semantic aspects.
 * Sends reviews in a single API call (batching strategy).
 */
export async function analyzeReviewBatch(
  reviews: ReviewWithText[],
  provider: AiProvider,
): Promise<ReviewSemanticAnalysis[]> {
  // Filter out reviews with NULL text
  const reviewsWithText = reviews.filter((r) => r.review_text && r.review_text.trim().length > 0);

  if (reviewsWithText.length === 0) {
    return [];
  }

  // Batch size safety limit
  const batch = reviewsWithText.slice(0, config.ai.batchSize || 20);

  const prompt = `Analyze each review separately. For each review, identify customer-voiced aspects and assign sentiment per aspect (not inherited from review-level sentiment).

For each aspect mentioned, return:
- aspect: the customer's concern/praise (string, not from a fixed list)
- sentiment: this aspect's sentiment ("positive", "negative", or "neutral")
- textSnippet: the exact phrase from the review supporting this observation
- confidence: 0-1, how confident you are in this extraction

IMPORTANT:
1. One review can have multiple independent aspects
2. Assign sentiment to EACH aspect separately, don't inherit review sentiment
3. Keep aspects separate if unrelated (don't force grouping)
4. Return empty observations array if no aspects found
5. Return JSON array with {canonicalReviewId, observations: [{aspect, sentiment, textSnippet, confidence}]}

Reviews to analyze:
${batch
  .map(
    (r) => `
ID: ${r.canonical_review_id}
Rating: ${r.rating}/5
Text: "${r.review_text}"`,
  )
  .join("\n")}

Return valid JSON only, no markdown or additional text.`;

  try {
    const result = await provider.analyzeReviewBatch?.(batch, prompt);

    if (!result) {
      console.warn("Provider returned null from analyzeReviewBatch");
      return [];
    }

    // Parse and validate the result
    const analyses: ReviewSemanticAnalysis[] = [];

    if (Array.isArray(result)) {
      for (const item of result) {
        if (
          item &&
          typeof item === "object" &&
          "canonicalReviewId" in item &&
          "observations" in item &&
          Array.isArray(item.observations)
        ) {
          analyses.push({
            canonicalReviewId: item.canonicalReviewId,
            platform: reviews[0]?.platform || "",
            sourceProductId: reviews[0]?.source_product_id || "",
            observations: item.observations.map((obs: any) => ({
              aspect: String(obs.aspect || ""),
              sentiment: (["positive", "negative", "neutral"].includes(obs.sentiment)
                ? obs.sentiment
                : "neutral") as AspectSentiment,
              textSnippet: String(obs.textSnippet || obs.evidence || ""),
              confidence: Math.max(0, Math.min(1, Number(obs.confidence) || 0.5)),
              sourceModel: config.ai.openaiModel || "gpt-4o",
            })),
            analyzedAt: new Date(),
          });
        }
      }
    }

    return analyses;
  } catch (error) {
    console.error("Batch analysis failed:", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Aggregates semantic analyses into ranked aspects.
 * Handles multiple aspects per review (counted once per aspect).
 */
export function aggregateSemanticAspects(
  analyses: ReviewSemanticAnalysis[],
  totalReviewCount: number,
  sentimentFilter?: AspectSentiment,
): SemanticAspectData[] {
  const aspectMap = new Map<string, SemanticAspectData>();

  for (const analysis of analyses) {
    for (const obs of analysis.observations) {
      // Filter by sentiment if requested
      if (sentimentFilter && obs.sentiment !== sentimentFilter) {
        continue;
      }

      const key = obs.aspect.toLowerCase();

      if (!aspectMap.has(key)) {
        aspectMap.set(key, {
          aspect: obs.aspect,
          count: 0,
          percentage: 0,
          reviewIds: [],
          sentiments: [],
          hasConflictingSentiment: false,
        });
      }

      const data = aspectMap.get(key)!;

      // Count this review once per aspect (even if multiple observations)
      if (!data.reviewIds.includes(analysis.canonicalReviewId)) {
        data.reviewIds.push(analysis.canonicalReviewId);
        data.count += 1;
      }

      // Track sentiment breakdown
      const sentimentEntry = data.sentiments.find((s) => s.sentiment === obs.sentiment);
      if (sentimentEntry) {
        sentimentEntry.count += 1;
      } else {
        data.sentiments.push({
          sentiment: obs.sentiment,
          count: 1,
        });
      }
    }
  }

  // Calculate percentages and detect conflicts
  for (const data of aspectMap.values()) {
    data.percentage = totalReviewCount > 0 ? (data.count / totalReviewCount) * 100 : 0;
    data.hasConflictingSentiment = data.sentiments.length > 1;
    // Sort sentiments by count descending
    data.sentiments.sort((a, b) => b.count - a.count);
  }

  // Sort by count descending
  const sorted = Array.from(aspectMap.values()).sort((a, b) => b.count - a.count);

  return sorted;
}

/**
 * Analyzes product reviews for an analytical intent.
 * Performs semantic analysis only when needed, respects budget.
 */
export async function analyzeProductReviewsForIntent(
  reviews: ReviewWithText[],
  intent: AnalyticalIntent,
  provider: AiProvider,
  budget?: number,
): Promise<{
  aspects: SemanticAspectData[];
  metadata: {
    reviewsAnalyzed: number;
    reviewsWithNullText: number;
    budgetUsed: number;
  };
}> {
  // Intent-specific budgets
  const budgets: Record<string, number> = {
    TOP_PROBLEM: 100,
    COMPLAINT_ANALYSIS: 100,
    POSITIVE_FEEDBACK: 50,
    RATING_DECLINE: 100,
    RECOMMENDATION: 100,
    EVIDENCE_RETRIEVAL: 50,
    TIME_COMPARISON: 100,
    REVIEW_EXPLORATION: 0, // No semantic analysis
    STATS_QUERY: 0, // No semantic analysis
  };

  const analysisBudget = budget ?? budgets[intent] ?? 0;

  // Early exit for intents that don't need semantic analysis
  if (analysisBudget === 0) {
    return {
      aspects: [],
      metadata: {
        reviewsAnalyzed: 0,
        reviewsWithNullText: 0,
        budgetUsed: 0,
      },
    };
  }

  // Count null-text reviews
  const reviewsWithText = reviews.filter((r) => r.review_text && r.review_text.trim().length > 0);
  const nullTextCount = reviews.length - reviewsWithText.length;

  // Respect budget
  const toAnalyze = reviewsWithText.slice(0, analysisBudget);

  // Batch analyze
  const batchSize = config.ai.batchSize || 20;
  const allAnalyses: ReviewSemanticAnalysis[] = [];

  for (let i = 0; i < toAnalyze.length; i += batchSize) {
    const batch = toAnalyze.slice(i, i + batchSize);
    try {
      const analyses = await analyzeReviewBatch(batch, provider);
      allAnalyses.push(...analyses);
    } catch (error) {
      console.error(`Batch failed at index ${i}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  // Aggregate
  let aspects = aggregateSemanticAspects(allAnalyses, reviews.length);

  // Filter by intent sentiment.
  // RECOMMENDATION must be grounded in NEGATIVE evidence (spec item 4) — a
  // recommendation is meaningless if the "dominant aspect" it picks is
  // actually the most-mentioned POSITIVE aspect just because it has a higher
  // raw count (e.g. "positive_feature" mentioned in more reviews than any
  // single negative complaint). Without this filter, RECOMMENDATION silently
  // degenerated into a positive-feature summary instead of an actionable fix.
  if (intent === "POSITIVE_FEEDBACK") {
    aspects = aspects.filter((a) => a.sentiments.some((s) => s.sentiment === "positive"));
  } else if (intent === "TOP_PROBLEM" || intent === "COMPLAINT_ANALYSIS" || intent === "RECOMMENDATION") {
    aspects = aspects.filter((a) => a.sentiments.some((s) => s.sentiment === "negative"));
  }

  return {
    aspects,
    metadata: {
      reviewsAnalyzed: toAnalyze.length,
      reviewsWithNullText: nullTextCount,
      budgetUsed: analysisBudget,
    },
  };
}

/**
 * Validates aspect counts match unique review ID sets.
 * Called before returning results to narrator.
 */
export function validateAspectCounts(
  aspects: SemanticAspectData[],
  totalReviews: number,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const aspect of aspects) {
    // Check for duplicates in review ID list
    const uniqueIds = new Set(aspect.reviewIds);
    if (uniqueIds.size !== aspect.reviewIds.length) {
      errors.push(`Aspect '${aspect.aspect}': duplicate review IDs in list`);
    }

    // Check count matches unique IDs
    if (uniqueIds.size !== aspect.count) {
      errors.push(
        `Aspect '${aspect.aspect}': count ${aspect.count} doesn't match unique IDs ${uniqueIds.size}`,
      );
    }

    // Check count doesn't exceed total
    if (aspect.count > totalReviews) {
      errors.push(`Aspect '${aspect.aspect}': count ${aspect.count} exceeds total reviews ${totalReviews}`);
    }

    // Validate sentiment counts
    const sentimentTotal = aspect.sentiments.reduce((sum, s) => sum + s.count, 0);
    if (sentimentTotal !== aspect.count) {
      errors.push(
        `Aspect '${aspect.aspect}': sentiment counts sum to ${sentimentTotal}, not ${aspect.count}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
