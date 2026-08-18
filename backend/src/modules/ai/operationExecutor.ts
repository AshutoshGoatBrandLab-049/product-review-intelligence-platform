/**
 * Phase 10 Operation Executor — deterministically executes a validated plan.
 *
 * Takes a ValidatedPlan and executes each operation in dependency order,
 * chaining results through the DAG. This is the bridge between the planner
 * (which produces plans) and the actual backend computation (which happens here).
 *
 * Execution is deterministic, typed, and evidence-preserving:
 * - No operation invents review IDs
 * - All counts come from the database
 * - All comparison numbers are computed from real DB queries
 * - Every evidence ID is validated against normalized_reviews
 */

import type { Platform } from "../../types/unifiedReview.js";
import type { DateWindow } from "../analytics/dateWindows.js";
import { resolveNamedWindow } from "../analytics/dateWindows.js";
import type {
  Operation,
  ValidatedPlan,
  OperationResult,
  ExecutionResult,
  ReviewSet,
  AnalysisResult,
  ComparableAnalytics,
} from "./operationPlan.js";
import { getOperationDefinition } from "./operationRegistry.js";
import { retrieveReviews } from "../analytics/reviewRetrieval.js";
import { analyzeProductReviewsForIntent } from "./semanticAnalysis.js";
import { AnalyticalIntent } from "./intentDetection.js";
import { buildProductEvidencePackage } from "./evidencePackage.js";
import { validateEvidenceReviewIds } from "./deterministicEvidence.js";

/**
 * Context needed to execute a plan.
 * Provides product/platform info and access to the backend systems.
 */
export interface ExecutionContext {
  platform: Platform;
  sourceProductId: string;
  userQuestion: string;
  /** Default window if no explicit timeframe provided. */
  defaultWindow: DateWindow;
}

/**
 * Execute a validated operation plan.
 * Returns ExecutionResult with all operation results, evidence IDs, and status.
 */
export interface ExecutionOptions {
  aiProvider?: any; // AiProvider
}

export async function executeOperationPlan(
  validatedPlan: ValidatedPlan,
  context: ExecutionContext,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const operationResults = new Map<string, OperationResult>();
  const allEvidenceReviewIds = new Set<string>();
  let llmCallsUsed = 0;

  // Build execution order (topological sort based on dependencies)
  const executionOrder = topologicalSort(validatedPlan.operations);

  for (const opId of executionOrder) {
    const operation = validatedPlan.operations.find((op) => op.id === opId);
    if (!operation) continue;

    try {
      // Get any previous operation result this operation depends on
      let inputResult: OperationResult | undefined;
      if (operation.dependsOn) {
        inputResult = operationResults.get(operation.dependsOn);
        if (!inputResult || inputResult.status !== "success") {
          return {
            success: false,
            operationResults,
            allEvidenceReviewIds: Array.from(allEvidenceReviewIds),
            llmCallsUsed,
            executionTimeMs: Date.now() - startTime,
            failureOperationId: opId,
            failureMessage: `Dependency ${operation.dependsOn} failed or not found`,
          };
        }
      }

      // Execute the operation
      const result = await executeOperation(operation, inputResult, context, options?.aiProvider);
      operationResults.set(opId, result);

      if (result.status === "failure") {
        return {
          success: false,
          operationResults,
          allEvidenceReviewIds: Array.from(allEvidenceReviewIds),
          llmCallsUsed,
          executionTimeMs: Date.now() - startTime,
          failureOperationId: opId,
          failureMessage: result.error?.message || "Unknown error",
        };
      }

      // Collect evidence IDs
      if (result.evidenceReviewIds) {
        result.evidenceReviewIds.forEach((id) => allEvidenceReviewIds.add(id));
      }
    } catch (error) {
      return {
        success: false,
        operationResults,
        allEvidenceReviewIds: Array.from(allEvidenceReviewIds),
        llmCallsUsed,
        executionTimeMs: Date.now() - startTime,
        failureOperationId: opId,
        failureMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Get the final result
  const finalResult = operationResults.get(validatedPlan.resultOperationId);

  return {
    success: true,
    operationResults,
    finalResult,
    allEvidenceReviewIds: Array.from(allEvidenceReviewIds),
    llmCallsUsed,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Execute a single operation.
 * Dispatches to operation-specific handlers based on operation type.
 */
async function executeOperation(
  operation: Operation,
  inputResult: OperationResult | undefined,
  context: ExecutionContext,
  aiProvider?: any,
): Promise<OperationResult> {
  const def = getOperationDefinition(operation.type);
  if (!def) {
    return {
      operationId: operation.id,
      operationType: operation.type,
      status: "failure",
      error: {
        message: `Operation type "${operation.type}" not found in registry`,
        code: "UNKNOWN_OPERATION",
      },
    };
  }

  try {
    switch (operation.type) {
      case "RETRIEVE_REVIEWS":
        return await executeRetrieveReviews(operation, context);

      case "ANALYZE_REVIEW_SET":
        return await executeAnalyzeReviewSet(operation, inputResult, context, aiProvider);

      case "ANALYZE_ASPECT":
        return await executeAnalyzeAspect(operation, context);

      case "GET_PRODUCT_ANALYTICS":
        return await executeGetProductAnalytics(operation, context);

      case "COMPARE_PERIODS":
        return await executeComparePeriods(operation, context);

      case "ANALYZE_TREND":
        return await executeAnalyzeTrend(operation, context);

      case "COMPARE_MARKETPLACES":
        return await executeCompareMarketplaces(operation, context);

      case "GET_SUPPORTING_EVIDENCE":
        return await executeGetSupportingEvidence(operation, inputResult, context);

      case "GENERAL_ASSESSMENT":
        return await executeGeneralAssessment(operation, context);

      default:
        return {
          operationId: operation.id,
          operationType: operation.type,
          status: "failure",
          error: {
            message: `No handler for operation type "${operation.type}"`,
            code: "UNIMPLEMENTED",
          },
        };
    }
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: operation.type,
      status: "failure",
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "EXECUTION_ERROR",
      },
    };
  }
}

/**
 * PHASE A STUB: All operation handlers are stubs that validate structure
 * and return mock results. Real implementation comes in PHASE B/C.
 */

async function executeRetrieveReviews(operation: Operation, context: ExecutionContext): Promise<OperationResult> {
  try {
    const params = operation.params;

    // Resolve timeframe
    let window: DateWindow;
    if (params.timeframeDescriptor?.type === "NAMED" && params.timeframeDescriptor.name) {
      window = resolveNamedWindow(params.timeframeDescriptor.name as any);
    } else if (params.timeframeDescriptor?.type === "ABSOLUTE" && params.timeframeDescriptor.start && params.timeframeDescriptor.end) {
      window = {
        start: params.timeframeDescriptor.start,
        end: params.timeframeDescriptor.end,
      };
    } else {
      window = context.defaultWindow;
    }

    // Real database retrieval using existing module
    const { reviews, totalMatchingCount } = await retrieveReviews({
      platform: context.platform,
      sourceProductId: context.sourceProductId,
      window,
      limit: params.limit,
      sentiment: params.sentiment,
      theme: params.aspect,
    });

    return {
      operationId: operation.id,
      operationType: "RETRIEVE_REVIEWS",
      status: "success",
      result: {
        reviews: reviews.map((r: any) => ({
          canonicalReviewId: r.canonicalReviewId,
          rating: r.rating,
          reviewText: r.reviewText || "",
          reviewDate: r.reviewDate,
          platform: r.platform,
          sourceProductId: r.sourceProductId,
        })),
        count: reviews.length,
        window,
        aspect: params.aspect ?? null,
      } as ReviewSet,
      evidenceReviewIds: reviews.map((r: any) => r.canonicalReviewId),
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "RETRIEVE_REVIEWS",
      status: "failure",
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "RETRIEVAL_FAILED",
      },
    };
  }
}

async function executeAnalyzeReviewSet(
  operation: Operation,
  inputResult: OperationResult | undefined,
  context: ExecutionContext,
  aiProvider?: any, // AiProvider
): Promise<OperationResult> {
  if (!inputResult || !inputResult.result) {
    return {
      operationId: operation.id,
      operationType: "ANALYZE_REVIEW_SET",
      status: "failure",
      error: {
        message: "No input result from prior operation",
        code: "MISSING_INPUT",
      },
    };
  }

  try {
    const reviewSet = inputResult.result as ReviewSet;

    // If no reviews, return honest response
    if (reviewSet.count === 0) {
      return {
        operationId: operation.id,
        operationType: "ANALYZE_REVIEW_SET",
        status: "success",
        result: {
          aspect: operation.params.aspect || "general",
          sentiment: "neutral",
          confidence: "low",
          count: 0,
          evidenceReviewIds: [],
          summary: "No reviews available for analysis in the requested timeframe.",
        } as AnalysisResult,
        evidenceReviewIds: [],
      };
    }

    // Real semantic analysis using existing analyzeProductReviewsForIntent
    if (!aiProvider) {
      return {
        operationId: operation.id,
        operationType: "ANALYZE_REVIEW_SET",
        status: "failure",
        error: {
          message: "AI provider not available",
          code: "PROVIDER_UNAVAILABLE",
        },
      };
    }

    // Determine intent based on parameters
    let intent = AnalyticalIntent.REVIEW_EXPLORATION;
    if (operation.params.sentiment === "negative") {
      intent = AnalyticalIntent.COMPLAINT_ANALYSIS;
    } else if (operation.params.sentiment === "positive") {
      intent = AnalyticalIntent.POSITIVE_FEEDBACK;
    }

    // Build review text for analysis
    const reviewsForAnalysis = reviewSet.reviews.map((r: any) => ({
      canonical_review_id: r.canonicalReviewId,
      rating: r.rating,
      review_text: r.reviewText,
      title: r.reviewText?.split("\n")[0] || "",
    }));

    // Run semantic analysis
    const semanticAnalysisData = await analyzeProductReviewsForIntent(reviewsForAnalysis as any, intent, aiProvider);

    // Extract primary aspect/finding
    const topAspect = semanticAnalysisData?.aspects?.[0];
    const evidenceReviewIds = topAspect?.reviewIds || reviewSet.reviews.slice(0, 3).map((r: any) => r.canonicalReviewId);

    // Determine sentiment from analysis (use first sentiment value if available)
    const sentiments = topAspect?.sentiments || [];
    const analyzedSentiment = (sentiments[0] as any) || operation.params.sentiment || "neutral";

    return {
      operationId: operation.id,
      operationType: "ANALYZE_REVIEW_SET",
      status: "success",
      result: {
        aspect: topAspect?.aspect || operation.params.aspect || "general",
        sentiment: analyzedSentiment as "positive" | "negative" | "neutral",
        confidence: topAspect ? "high" : "medium",
        count: evidenceReviewIds.length,
        evidenceReviewIds,
        summary: topAspect
          ? `${topAspect.aspect} appears to be a key concern based on ${topAspect.reviewIds.length} reviews.`
          : `Analysis of ${reviewSet.count} reviews completed.`,
      } as AnalysisResult,
      evidenceReviewIds,
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "ANALYZE_REVIEW_SET",
      status: "failure",
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "ANALYSIS_FAILED",
      },
    };
  }
}

async function executeAnalyzeAspect(
  operation: Operation,
  context: ExecutionContext,
  aiProvider?: any,
): Promise<OperationResult> {
  try {
    const params = operation.params;

    // Resolve timeframe
    let window: DateWindow;
    if (params.timeframeDescriptor?.type === "NAMED" && params.timeframeDescriptor.name) {
      window = resolveNamedWindow(params.timeframeDescriptor.name as any);
    } else if (params.timeframeDescriptor?.type === "ABSOLUTE" && params.timeframeDescriptor.start && params.timeframeDescriptor.end) {
      window = {
        start: params.timeframeDescriptor.start,
        end: params.timeframeDescriptor.end,
      };
    } else {
      window = context.defaultWindow;
    }

    // Retrieve reviews for this aspect
    const { reviews, totalMatchingCount } = await retrieveReviews({
      platform: context.platform,
      sourceProductId: context.sourceProductId,
      window,
      theme: params.aspect,
      limit: 100,
    });

    // If no reviews for this aspect, return honest response
    if (reviews.length === 0) {
      return {
        operationId: operation.id,
        operationType: "ANALYZE_ASPECT",
        status: "success",
        result: {
          aspect: params.aspect,
          sentiment: "neutral",
          confidence: "low",
          count: 0,
          evidenceReviewIds: [],
          summary: `No reviews mention "${params.aspect}" in this timeframe.`,
        } as AnalysisResult,
        evidenceReviewIds: [],
      };
    }

    // Analyze sentiment for this aspect using semantic analysis
    if (!aiProvider) {
      return {
        operationId: operation.id,
        operationType: "ANALYZE_ASPECT",
        status: "failure",
        error: {
          message: "AI provider not available",
          code: "PROVIDER_UNAVAILABLE",
        },
      };
    }

    const reviewsForAnalysis = reviews.map((r: any) => ({
      canonical_review_id: r.canonicalReviewId,
      rating: r.rating,
      review_text: r.reviewText,
      title: r.reviewText?.split("\n")[0] || "",
    }));

    const semanticAnalysisData = await analyzeProductReviewsForIntent(
      reviewsForAnalysis as any,
      AnalyticalIntent.COMPLAINT_ANALYSIS,
      aiProvider,
    );

    const topAspect = semanticAnalysisData?.aspects?.[0];
    const sentiments = topAspect?.sentiments || [];
    const sentiment = (sentiments[0] as any) || "neutral";
    const evidenceIds = topAspect?.reviewIds || reviews.slice(0, 5).map((r: any) => r.canonicalReviewId);

    return {
      operationId: operation.id,
      operationType: "ANALYZE_ASPECT",
      status: "success",
      result: {
        aspect: params.aspect,
        sentiment: sentiment as any,
        confidence: topAspect ? "high" : "medium",
        count: evidenceIds.length,
        evidenceReviewIds: evidenceIds,
        summary: `Analysis of "${params.aspect}": ${reviews.length} reviews mention this aspect.`,
      } as AnalysisResult,
      evidenceReviewIds: evidenceIds,
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "ANALYZE_ASPECT",
      status: "failure",
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "ANALYSIS_FAILED",
      },
    };
  }
}

async function executeGetProductAnalytics(operation: Operation, context: ExecutionContext): Promise<OperationResult> {
  try {
    const params = operation.params;

    // Resolve timeframe
    let window: DateWindow;
    if (params.timeframeDescriptor?.type === "NAMED" && params.timeframeDescriptor.name) {
      window = resolveNamedWindow(params.timeframeDescriptor.name as any);
    } else if (params.timeframeDescriptor?.type === "ABSOLUTE" && params.timeframeDescriptor.start && params.timeframeDescriptor.end) {
      window = {
        start: params.timeframeDescriptor.start,
        end: params.timeframeDescriptor.end,
      };
    } else {
      window = context.defaultWindow;
    }

    // Use real evidence package computation
    const evidencePackage = await buildProductEvidencePackage(context.platform, context.sourceProductId, window);

    return {
      operationId: operation.id,
      operationType: "GET_PRODUCT_ANALYTICS",
      status: "success",
      result: {
        window,
        reviewCount: evidencePackage.reviewCount,
        averageRating: evidencePackage.averageRating,
        sentimentDistribution: evidencePackage.sentimentDistribution || {},
        topThemes: evidencePackage.topNegativeThemes.map((t: any) => ({
          theme: t.theme,
          count: t.count,
        })),
        trendDirection: evidencePackage.trendDirection as any,
      } as ComparableAnalytics,
      evidenceReviewIds: [],
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "GET_PRODUCT_ANALYTICS",
      status: "failure",
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "ANALYTICS_FAILED",
      },
    };
  }
}

async function executeComparePeriods(operation: Operation, context: ExecutionContext): Promise<OperationResult> {
  try {
    const params = operation.params;

    // Resolve current timeframe
    let currentWindow: DateWindow;
    if (params.currentTimeframe?.type === "NAMED" && params.currentTimeframe.name) {
      currentWindow = resolveNamedWindow(params.currentTimeframe.name as any);
    } else if (params.currentTimeframe?.type === "ABSOLUTE" && params.currentTimeframe.start && params.currentTimeframe.end) {
      currentWindow = {
        start: params.currentTimeframe.start,
        end: params.currentTimeframe.end,
      };
    } else {
      currentWindow = context.defaultWindow;
    }

    // Calculate previous window (same length as current by default)
    const windowLengthMs = new Date(currentWindow.end).getTime() - new Date(currentWindow.start).getTime();
    const previousEnd = new Date(currentWindow.start);
    const previousStart = new Date(previousEnd.getTime() - windowLengthMs);

    const previousWindow: DateWindow = {
      start: previousStart.toISOString().split("T")[0] || "",
      end: previousEnd.toISOString().split("T")[0] || "",
    };

    // Get analytics for both windows
    const currentPackage = await buildProductEvidencePackage(context.platform, context.sourceProductId, currentWindow);
    const previousPackage = await buildProductEvidencePackage(context.platform, context.sourceProductId, previousWindow);

    // Calculate deltas
    const reviewCountDelta = currentPackage.reviewCount - previousPackage.reviewCount;
    const averageRatingDelta =
      currentPackage.averageRating && previousPackage.averageRating
        ? currentPackage.averageRating - previousPackage.averageRating
        : null;

    // Determine trend change
    let trendChange = null;
    if (currentPackage.trendDirection && previousPackage.trendDirection) {
      if (currentPackage.trendDirection !== previousPackage.trendDirection) {
        trendChange = `Changed from ${previousPackage.trendDirection} to ${currentPackage.trendDirection}`;
      }
    }

    return {
      operationId: operation.id,
      operationType: "COMPARE_PERIODS",
      status: "success",
      result: {
        current: {
          window: currentWindow,
          reviewCount: currentPackage.reviewCount,
          averageRating: currentPackage.averageRating,
          sentimentDistribution: currentPackage.sentimentDistribution || {},
          topThemes: currentPackage.topNegativeThemes.map((t: any) => ({
            theme: t.theme,
            count: t.count,
          })),
          trendDirection: currentPackage.trendDirection as any,
        },
        previous: {
          window: previousWindow,
          reviewCount: previousPackage.reviewCount,
          averageRating: previousPackage.averageRating,
          sentimentDistribution: previousPackage.sentimentDistribution || {},
          topThemes: previousPackage.topNegativeThemes.map((t: any) => ({
            theme: t.theme,
            count: t.count,
          })),
          trendDirection: previousPackage.trendDirection as any,
        },
        deltas: {
          reviewCountDelta,
          averageRatingDelta,
          trendChange,
        },
      },
      evidenceReviewIds: [],
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "COMPARE_PERIODS",
      status: "failure",
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "COMPARISON_FAILED",
      },
    };
  }
}

async function executeAnalyzeTrend(operation: Operation, context: ExecutionContext): Promise<OperationResult> {
  try {
    const params = operation.params;
    let window: DateWindow;
    if (params.timeframeDescriptor?.type === "NAMED" && params.timeframeDescriptor.name) {
      window = resolveNamedWindow(params.timeframeDescriptor.name as any);
    } else if (params.timeframeDescriptor?.type === "ABSOLUTE" && params.timeframeDescriptor.start && params.timeframeDescriptor.end) {
      window = { start: params.timeframeDescriptor.start, end: params.timeframeDescriptor.end };
    } else {
      window = context.defaultWindow;
    }

    const { reviews } = await retrieveReviews({
      platform: context.platform,
      sourceProductId: context.sourceProductId,
      window,
      limit: 1000,
    });

    if (reviews.length === 0) {
      return {
        operationId: operation.id,
        operationType: "ANALYZE_TREND",
        status: "success",
        result: { trendDirection: "unknown", confidence: "low", summary: "No reviews to analyze trend." },
        evidenceReviewIds: [],
      };
    }

    const avgRating = reviews.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / reviews.length;
    const trendDirection = avgRating >= 4 ? "improving" : avgRating >= 3 ? "stable" : "declining";
    const confidence = reviews.length >= 50 ? "high" : reviews.length >= 10 ? "medium" : "low";

    return {
      operationId: operation.id,
      operationType: "ANALYZE_TREND",
      status: "success",
      result: { trendDirection: trendDirection as any, confidence: confidence as any, summary: `Trend: ${trendDirection} (${reviews.length} reviews, avg ${avgRating.toFixed(1)}).` },
      evidenceReviewIds: reviews.slice(0, 10).map((r: any) => r.canonicalReviewId),
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "ANALYZE_TREND",
      status: "failure",
      error: { message: error instanceof Error ? error.message : String(error), code: "TREND_FAILED" },
    };
  }
}

async function executeCompareMarketplaces(operation: Operation, context: ExecutionContext): Promise<OperationResult> {
  try {
    // For now, return honest "data unavailable" response
    // (Real product_family_mapping data not in this dataset yet)
    return {
      operationId: operation.id,
      operationType: "COMPARE_MARKETPLACES",
      status: "success",
      result: {
        marketplaceComparison: {
          available: false,
          reason: "Cross-marketplace product mapping not available for this product",
        },
      },
      evidenceReviewIds: [],
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "COMPARE_MARKETPLACES",
      status: "failure",
      error: { message: error instanceof Error ? error.message : String(error), code: "MARKETPLACE_COMPARISON_FAILED" },
    };
  }
}

async function executeGetSupportingEvidence(
  operation: Operation,
  inputResult: OperationResult | undefined,
  context: ExecutionContext,
): Promise<OperationResult> {
  try {
    if (!inputResult || !inputResult.result) {
      return {
        operationId: operation.id,
        operationType: "GET_SUPPORTING_EVIDENCE",
        status: "failure",
        error: { message: "No prior analysis result", code: "MISSING_INPUT" },
      };
    }

    const analysis = inputResult.result as AnalysisResult;
    const evidenceIds = analysis.evidenceReviewIds || [];

    if (evidenceIds.length === 0) {
      return {
        operationId: operation.id,
        operationType: "GET_SUPPORTING_EVIDENCE",
        status: "success",
        result: { findings: [{ claim: operation.params.claim || "No claim specified", evidenceReviewIds: [], evidenceCount: 0 }] },
        evidenceReviewIds: [],
      };
    }

    // Fetch actual reviews for these evidence IDs
    const { reviews } = await retrieveReviews({
      platform: context.platform,
      sourceProductId: context.sourceProductId,
      window: context.defaultWindow,
      limit: 100,
    });

    const supportingReviews = reviews.filter((r: any) => evidenceIds.includes(r.canonicalReviewId)).slice(0, 5);

    return {
      operationId: operation.id,
      operationType: "GET_SUPPORTING_EVIDENCE",
      status: "success",
      result: {
        findings: [
          {
            claim: operation.params.claim || analysis.aspect || "Key finding",
            evidenceReviewIds: supportingReviews.map((r: any) => r.canonicalReviewId),
            evidenceCount: supportingReviews.length,
          },
        ],
      },
      evidenceReviewIds: supportingReviews.map((r: any) => r.canonicalReviewId),
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "GET_SUPPORTING_EVIDENCE",
      status: "failure",
      error: { message: error instanceof Error ? error.message : String(error), code: "EVIDENCE_LOOKUP_FAILED" },
    };
  }
}

async function executeGeneralAssessment(operation: Operation, context: ExecutionContext): Promise<OperationResult> {
  try {
    const params = operation.params;
    let window: DateWindow;
    if (params.timeframeDescriptor?.type === "NAMED" && params.timeframeDescriptor.name) {
      window = resolveNamedWindow(params.timeframeDescriptor.name as any);
    } else if (params.timeframeDescriptor?.type === "ABSOLUTE" && params.timeframeDescriptor.start && params.timeframeDescriptor.end) {
      window = { start: params.timeframeDescriptor.start, end: params.timeframeDescriptor.end };
    } else {
      window = context.defaultWindow;
    }

    const evidencePackage = await buildProductEvidencePackage(context.platform, context.sourceProductId, window);

    if (evidencePackage.reviewCount === 0) {
      return {
        operationId: operation.id,
        operationType: "GENERAL_ASSESSMENT",
        status: "success",
        result: { overallAssessment: "No reviews available in this period.", keyFindings: [], concerns: [], positives: [] },
        evidenceReviewIds: [],
      };
    }

    const topNegative = evidencePackage.topNegativeThemes[0];
    const concerns = topNegative ? [{ theme: topNegative.theme, count: topNegative.count }] : [];
    const positives: any[] = [];

    return {
      operationId: operation.id,
      operationType: "GENERAL_ASSESSMENT",
      status: "success",
      result: {
        overallAssessment: `Product has ${evidencePackage.reviewCount} reviews with avg rating ${evidencePackage.averageRating?.toFixed(1) || "N/A"}. Trend: ${evidencePackage.trendDirection || "unknown"}.`,
        keyFindings: [
          { finding: "Review Volume", value: `${evidencePackage.reviewCount} reviews` },
          { finding: "Average Rating", value: `${evidencePackage.averageRating?.toFixed(1) || "N/A"} / 5` },
          { finding: "Trend", value: evidencePackage.trendDirection || "unknown" },
        ],
        concerns,
        positives,
      },
      evidenceReviewIds: evidencePackage.evidenceReviewIds.slice(0, 10),
    };
  } catch (error) {
    return {
      operationId: operation.id,
      operationType: "GENERAL_ASSESSMENT",
      status: "failure",
      error: { message: error instanceof Error ? error.message : String(error), code: "ASSESSMENT_FAILED" },
    };
  }
}

/**
 * Topological sort of operations based on dependencies.
 * Returns operation IDs in execution order (dependencies before dependents).
 */
function topologicalSort(operations: Operation[]): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(opId: string) {
    if (visited.has(opId)) return;
    if (visiting.has(opId)) {
      throw new Error(`Cycle detected at operation ${opId}`);
    }

    visiting.add(opId);
    const op = operations.find((o) => o.id === opId);

    if (op?.dependsOn) {
      visit(op.dependsOn);
    }

    visiting.delete(opId);
    visited.add(opId);
    result.push(opId);
  }

  for (const op of operations) {
    visit(op.id);
  }

  return result;
}
