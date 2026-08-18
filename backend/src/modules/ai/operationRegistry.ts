/**
 * Phase 10 Operation Registry — defines the complete set of SUPPORTED operations
 * that the LLM planner may select from, with full metadata about each:
 * purpose, allowed parameters, input/output types, dependencies, deterministic
 * implementation, and validation rules.
 *
 * This is the authoritative whitelist. The planner CANNOT invent new operations.
 * The validator CANNOT execute operations not in this registry.
 * Extending this registry is an explicit architectural decision, never implicit.
 */

import { z } from "zod";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Strongly-typed input/output schemas for operation result chaining.
 * These allow the validator and executor to verify that operation dependencies
 * form a valid execution graph (output type from op A must be assignable to
 * input type needed by op B).
 */

// ============ OPERATION RESULT TYPES ============

export const ReviewSetSchema = z.object({
  reviews: z.array(
    z.object({
      canonicalReviewId: z.string(),
      rating: z.number().optional(),
      reviewText: z.string(),
      reviewDate: z.string(),
      platform: z.string(),
      sourceProductId: z.string(),
    }),
  ),
  count: z.number(),
  window: z.object({ start: z.string(), end: z.string() }),
  aspect: z.string().nullable(), // aspect used to filter, if any
});

export type ReviewSet = z.infer<typeof ReviewSetSchema>;

export const AnalysisResultSchema = z.object({
  aspect: z.string(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.enum(["high", "medium", "low"]),
  count: z.number(), // number of reviews supporting this finding
  evidenceReviewIds: z.array(z.string()),
  summary: z.string(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const ComparableAnalyticsSchema = z.object({
  window: z.object({ start: z.string(), end: z.string() }),
  reviewCount: z.number(),
  averageRating: z.number().nullable(),
  sentimentDistribution: z.record(z.string(), z.number()),
  topThemes: z.array(z.object({ theme: z.string(), count: z.number() })),
  trendDirection: z.enum(["improving", "declining", "stable"]).nullable(),
});

export type ComparableAnalytics = z.infer<typeof ComparableAnalyticsSchema>;

export const ComparisonResultSchema = z.object({
  current: ComparableAnalyticsSchema,
  previous: ComparableAnalyticsSchema,
  deltas: z.object({
    reviewCountDelta: z.number(),
    averageRatingDelta: z.number().nullable(),
    trendChange: z.string().nullable(),
  }),
});

export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

export const EvidenceResultSchema = z.object({
  findings: z.array(
    z.object({
      claim: z.string(),
      evidenceReviewIds: z.array(z.string()),
      evidenceCount: z.number(),
    }),
  ),
});

export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;

export const FindingSchema = z.object({
  aspect: z.string(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  summary: z.string(),
  evidenceReviewIds: z.array(z.string()),
});

export type Finding = z.infer<typeof FindingSchema>;

// ============ OPERATION DEFINITIONS ============

export interface OperationDefinition {
  /**
   * Unique operation identifier, used in operation plans.
   * Examples: "RETRIEVE_REVIEWS", "ANALYZE_REVIEW_SET", "COMPARE_PERIODS"
   */
  type: string;

  /**
   * Human-readable description for LLM prompt and logs.
   */
  description: string;

  /**
   * Zod schema for allowed parameters — defines exactly what inputs this
   * operation accepts and validates their types/ranges/constraints.
   * Examples: timeframe, aspect, sentiment, limit, previousWindow.
   */
  allowedParams: z.ZodSchema;

  /**
   * Zod schema for the output this operation produces. Used by the validator
   * to verify downstream operations can consume this result.
   */
  outputSchema: z.ZodSchema;

  /**
   * Array of operation types this operation can accept as input via dependency.
   * Empty array means this operation takes no dependencies (e.g., RETRIEVE_REVIEWS
   * with no prior aspect context).
   * Examples: ["RETRIEVE_REVIEWS"], ["ANALYZE_REVIEW_SET", "RETRIEVE_REVIEWS"]
   */
  acceptedInputTypes: string[];

  /**
   * Required parameter names. If a required parameter is missing from the plan,
   * the validator rejects it.
   */
  requiredParams: string[];

  /**
   * Optional parameter names. These may be omitted without error.
   */
  optionalParams: string[];

  /**
   * Relative cost estimate for latency/billing calculations.
   * Used to detect unexpectedly expensive plans ("comparing 1000 products").
   */
  costEstimate: "low" | "medium" | "high";

  /**
   * Whether this operation may consume previous operation output via dependency.
   * If false, acceptedInputTypes must be empty and no dependencies allowed.
   */
  acceptsDependency: boolean;

  /**
   * What evidence (review IDs) does this operation produce?
   * "carries_through" — passes evidence from input operation
   * "deterministic" — backend computes from DB, never AI-invented
   * "none" — produces no evidence (e.g., analytics-only operations)
   */
  evidenceBehavior: "carries_through" | "deterministic" | "none";

  /**
   * Examples or use-case descriptions for the LLM prompt.
   */
  examples: string[];
}

/**
 * OPERATION_REGISTRY — the authoritative list of all supported operations.
 * Adding a new operation is an explicit decision requiring:
 * 1. Clear definition of what it does
 * 2. Deterministic backend implementation
 * 3. Strong typing for inputs/outputs
 * 4. Validation of parameter constraints
 * 5. Update to this registry
 */
export const OPERATION_REGISTRY = new Map<string, OperationDefinition>([
  [
    "RETRIEVE_REVIEWS",
    {
      type: "RETRIEVE_REVIEWS",
      description: "Retrieve actual review records matching filters (timeframe, aspect, sentiment, limit)",
      allowedParams: z.object({
        timeframeDescriptor: z
          .object({
            type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
            value: z.number().positive().optional(),
            unit: z.enum(["day", "week", "month", "year"]).optional(),
            start: z.string().optional(),
            end: z.string().optional(),
            name: z.string().optional(),
          })
          .strict(),
        aspect: z.string().max(200).optional(),
        sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
        limit: z.number().positive().max(1000).optional(),
      }),
      outputSchema: ReviewSetSchema,
      acceptedInputTypes: [],
      requiredParams: ["timeframeDescriptor"],
      optionalParams: ["aspect", "sentiment", "limit"],
      costEstimate: "low",
      acceptsDependency: false,
      evidenceBehavior: "deterministic",
      examples: [
        "Show me 20 reviews from the last 7 days",
        "Get negative reviews about 'zipper' from January",
        "Retrieve positive reviews, top 10",
      ],
    },
  ],

  [
    "ANALYZE_REVIEW_SET",
    {
      type: "ANALYZE_REVIEW_SET",
      description:
        "Analyze a retrieved review set to identify dominant sentiment/aspects. " +
        "Requires review data as input (from RETRIEVE_REVIEWS or similar).",
      allowedParams: z.object({
        aspect: z.string().max(200).optional(),
        sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
      }),
      outputSchema: AnalysisResultSchema,
      acceptedInputTypes: ["RETRIEVE_REVIEWS"],
      requiredParams: [],
      optionalParams: ["aspect", "sentiment"],
      costEstimate: "medium",
      acceptsDependency: true,
      evidenceBehavior: "deterministic",
      examples: [
        "Analyze the retrieved zipper reviews for common complaints",
        "What sentiment dominates in these 50 reviews?",
        "Identify key themes in the negative reviews",
      ],
    },
  ],

  [
    "ANALYZE_ASPECT",
    {
      type: "ANALYZE_ASPECT",
      description: "Deep dive into sentiment and prevalence for a specific aspect (e.g., 'battery', 'delivery')",
      allowedParams: z.object({
        aspect: z.string().max(200),
        timeframeDescriptor: z.object({
          type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
          value: z.number().positive().optional(),
          unit: z.enum(["day", "week", "month", "year"]).optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
      outputSchema: AnalysisResultSchema,
      acceptedInputTypes: [],
      requiredParams: ["aspect", "timeframeDescriptor"],
      optionalParams: [],
      costEstimate: "medium",
      acceptsDependency: false,
      evidenceBehavior: "deterministic",
      examples: [
        "How is 'build quality' sentiment-wise in reviews from last month?",
        "Analyze 'battery' complaints over the past 90 days",
        "What do customers say about 'delivery speed'?",
      ],
    },
  ],

  [
    "GET_PRODUCT_ANALYTICS",
    {
      type: "GET_PRODUCT_ANALYTICS",
      description:
        "Retrieve product-level analytics (review count, rating, sentiment distribution, top themes, trend) " +
        "for a specified timeframe.",
      allowedParams: z.object({
        timeframeDescriptor: z.object({
          type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
          value: z.number().positive().optional(),
          unit: z.enum(["day", "week", "month", "year"]).optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
      outputSchema: ComparableAnalyticsSchema,
      acceptedInputTypes: [],
      requiredParams: ["timeframeDescriptor"],
      optionalParams: [],
      costEstimate: "low",
      acceptsDependency: false,
      evidenceBehavior: "none",
      examples: [
        "Get product metrics for the last 30 days",
        "What's the overall trend for the past quarter?",
        "How many reviews in the current month?",
      ],
    },
  ],

  [
    "COMPARE_PERIODS",
    {
      type: "COMPARE_PERIODS",
      description:
        "Compare product analytics between a current period and a previous equivalent period. " +
        "Produces measured deltas (review count change, rating change, trend shift).",
      allowedParams: z.object({
        currentTimeframe: z.object({
          type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
          value: z.number().positive().optional(),
          unit: z.enum(["day", "week", "month", "year"]).optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          name: z.string().optional(),
        }),
        periodLength: z.enum(["same_length", "previous_period", "year_ago"]).optional(),
      }),
      outputSchema: ComparisonResultSchema,
      acceptedInputTypes: [],
      requiredParams: ["currentTimeframe"],
      optionalParams: ["periodLength"],
      costEstimate: "medium",
      acceptsDependency: false,
      evidenceBehavior: "none",
      examples: [
        "Compare this month vs last month",
        "Show me the week-over-week change",
        "How does January compare to December?",
      ],
    },
  ],

  [
    "ANALYZE_TREND",
    {
      type: "ANALYZE_TREND",
      description:
        "Identify and explain trend direction (improving, declining, stable) over a specified period.",
      allowedParams: z.object({
        timeframeDescriptor: z.object({
          type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
          value: z.number().positive().optional(),
          unit: z.enum(["day", "week", "month", "year"]).optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
      outputSchema: z.object({
        trendDirection: z.enum(["improving", "declining", "stable"]),
        confidence: z.enum(["high", "medium", "low"]),
        summary: z.string(),
      }),
      acceptedInputTypes: [],
      requiredParams: ["timeframeDescriptor"],
      optionalParams: [],
      costEstimate: "low",
      acceptsDependency: false,
      evidenceBehavior: "none",
      examples: [
        "Is the product rating improving or declining?",
        "What's the trend over the last 90 days?",
        "Is sentiment getting better or worse?",
      ],
    },
  ],

  [
    "COMPARE_MARKETPLACES",
    {
      type: "COMPARE_MARKETPLACES",
      description:
        "Compare this product across different marketplaces (Flipkart vs Myntra, etc) if cross-marketplace " +
        "mapping data is available. Returns honest 'data unavailable' if mapping does not exist.",
      allowedParams: z.object({
        timeframeDescriptor: z.object({
          type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
          value: z.number().positive().optional(),
          unit: z.enum(["day", "week", "month", "year"]).optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
      outputSchema: z.object({
        marketplaceComparison: z.union([
          z.object({
            available: z.literal(true),
            data: z.record(
              z.string(),
              z.object({
                platform: z.string(),
                reviewCount: z.number(),
                averageRating: z.number().nullable(),
                sentimentDistribution: z.record(z.string(), z.number()),
              }),
            ),
          }),
          z.object({
            available: z.literal(false),
            reason: z.string(),
          }),
        ]),
      }),
      acceptedInputTypes: [],
      requiredParams: ["timeframeDescriptor"],
      optionalParams: [],
      costEstimate: "medium",
      acceptsDependency: false,
      evidenceBehavior: "none",
      examples: [
        "How does this product perform on Flipkart vs Myntra?",
        "Compare ratings across all available marketplaces",
      ],
    },
  ],

  [
    "GET_SUPPORTING_EVIDENCE",
    {
      type: "GET_SUPPORTING_EVIDENCE",
      description:
        "Retrieve specific review IDs that support a particular finding or claim. " +
        "Requires a prior analysis result (Finding) as input.",
      allowedParams: z.object({
        claim: z.string().max(500),
      }),
      outputSchema: EvidenceResultSchema,
      acceptedInputTypes: ["ANALYZE_REVIEW_SET", "ANALYZE_ASPECT"],
      requiredParams: ["claim"],
      optionalParams: [],
      costEstimate: "medium",
      acceptsDependency: true,
      evidenceBehavior: "carries_through",
      examples: ["Show me the reviews that mention 'zipper breaking'", "Provide evidence for the quality complaint"],
    },
  ],

  [
    "GENERAL_ASSESSMENT",
    {
      type: "GENERAL_ASSESSMENT",
      description:
        "Provide a holistic, open-ended assessment of the product without forcing into specific metrics. " +
        "Suitable for broad questions like 'tell me something important' or 'full picture'.",
      allowedParams: z.object({
        timeframeDescriptor: z.object({
          type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
          value: z.number().positive().optional(),
          unit: z.enum(["day", "week", "month", "year"]).optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          name: z.string().optional(),
        }),
      }),
      outputSchema: z.object({
        overallAssessment: z.string(),
        keyFindings: z.array(z.string()),
        concerns: z.array(z.string()).optional(),
        positives: z.array(z.string()).optional(),
      }),
      acceptedInputTypes: [],
      requiredParams: ["timeframeDescriptor"],
      optionalParams: [],
      costEstimate: "high",
      acceptsDependency: false,
      evidenceBehavior: "deterministic",
      examples: [
        "What's important to know about this product?",
        "Give me your full picture of how this product is doing",
        "Is there anything unusual I should know?",
      ],
    },
  ],
]);

/**
 * Helper: validate that an operation type exists in the registry.
 */
export function isOperationSupported(operationType: string): boolean {
  return OPERATION_REGISTRY.has(operationType);
}

/**
 * Helper: get an operation definition from the registry.
 */
export function getOperationDefinition(operationType: string): OperationDefinition | undefined {
  return OPERATION_REGISTRY.get(operationType);
}

/**
 * Helper: all operation types currently in the registry (for LLM enums).
 */
export function getSupportedOperationTypes(): string[] {
  return Array.from(OPERATION_REGISTRY.keys());
}
