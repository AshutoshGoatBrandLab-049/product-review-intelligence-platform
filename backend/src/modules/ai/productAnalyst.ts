import type { Platform } from "../../types/unifiedReview.js";
import type { DateWindow, NamedWindow } from "../analytics/dateWindows.js";
import { resolveNamedWindow } from "../analytics/dateWindows.js";
import { buildProductEvidencePackage } from "./evidencePackage.js";
import { narrateProductEvidence } from "./narrator.js";
import { getCachedQuestion, cacheQuestion } from "./questionCache.js";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { QueryTypes } from "sequelize";
import type { AiProvider } from "./providers/aiProvider.js";
import type { ProductAnalystResponse } from "../../api/controllers/analyst.js";
import { detectIntent, isRetrievalIntent, type PriorTurnContext } from "./intentDetection.js";
import { AnalyticalIntent } from "./intentDetection.js";
import { debugResolvedQuery, type ResolvedQuery } from "./queryResolution.js";
import { resolveQuerySemantic } from "./queryUnderstanding.js";
import type { ReviewWithText } from "./types.js";
import { analyzeProductReviewsForIntent } from "./semanticAnalysis.js";
import {
  buildDeterministicRootCause,
  validateEvidenceIntegrity,
  validateEvidenceReviewIds,
} from "./deterministicEvidence.js";
import { retrieveReviews, deriveReviewFiltersFromQuestion } from "../analytics/reviewRetrieval.js";
import { getConversation, appendConversationMessage } from "./conversationStore.js";
import type { ConversationMessage } from "../../database/appStore/models/aiConversation.js";
import { planOperations } from "./semanticPlanner.js";
import { executeOperationPlan } from "./operationExecutor.js";
import { resolveNamedWindow as resolveNamedWindowHelper } from "../analytics/dateWindows.js";

/**
 * Phase 10 Step 2 — AI Product Analyst orchestration with question caching.
 * Receives a user question about a specific product and determines what
 * verified data is needed, retrieves it, and passes it to the narrator.
 * Questions are cached with a 30-day TTL to avoid duplicate AI calls.
 *
 * Phase 10 AI Product Analyst intent/context correction: this orchestrator
 * now branches on RETRIEVAL vs ANALYSIS vs NEEDS_CLARIFICATION before ever
 * touching the AI provider. A retrieval question ("show me the bad reviews")
 * never reaches narrateProductEvidence() — it is answered entirely from
 * retrieveReviews(), so it structurally cannot be fabricated.
 */

export interface ProductAnalystRequest {
  platform: Platform;
  sourceProductId: string;
  userQuestion: string;
  window?: NamedWindow;
  /** Optional — when supplied, prior-turn context is loaded to resolve ambiguous follow-ups. */
  conversationId?: string;
}

const CLARIFICATION_PROMPT_FALLBACK =
  "What would you like me to show — the latest reviews, supporting evidence, or the product analysis?";

/**
 * Detect what time window the user is asking about from their natural language question.
 * Returns the detected window or defaults to "30d".
 */
function detectWindowFromQuestion(question: string): NamedWindow {
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes("last 7") || lowerQ.includes("past 7") || lowerQ.includes("7 day")) return "7d";
  if (lowerQ.includes("last 30") || lowerQ.includes("past 30") || lowerQ.includes("30 day")) return "30d";
  if (lowerQ.includes("last 60") || lowerQ.includes("past 60") || lowerQ.includes("60 day")) return "60d";
  if (lowerQ.includes("last 90") || lowerQ.includes("past 90") || lowerQ.includes("90 day")) return "90d";
  if (lowerQ.includes("last 6") || lowerQ.includes("past 6") || lowerQ.includes("6 month")) return "6m";
  if (lowerQ.includes("last year") || lowerQ.includes("past year") || lowerQ.includes("yearly")) return "12m";

  return "30d";
}

/**
 * Check if this product exists at all (any review, any window).
 *
 * Phase 10 query-understanding correction bug fix: this previously scoped
 * existence to the requested window itself, which meant a legitimate narrow
 * timeframe query ("last 5 days") against a real product with genuinely zero
 * reviews in that 5-day slice would throw "Product not found" instead of
 * answering "No matching reviews found for the requested period" — a real
 * timeframe expression could now produce exactly this narrow window (see
 * timeframeResolution.ts), which the old fixed 7/30/60/90-day set almost
 * never did in practice. Product existence and "does this window have any
 * matches" are two different questions — the latter is legitimately zero and
 * must be answered, not treated as a 404.
 */
async function verifyProductExists(platform: Platform, sourceProductId: string): Promise<boolean> {
  const schema = config.appStore.schema;

  const result = (await appSequelize.query(
    `SELECT COUNT(*) as count FROM "${schema}".normalized_reviews
     WHERE platform = :platform AND source_product_id = :sourceProductId`,
    {
      type: QueryTypes.SELECT,
      replacements: { platform, sourceProductId },
    },
  )) as any[];

  return result.length > 0 && (result[0] as any)?.count > 0;
}

/**
 * Retrieve reviews with full text for semantic analysis.
 * Phase 10 Step 3 — used to perform semantic aspect discovery.
 */
async function getReviewsWithText(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
  limit?: number,
): Promise<ReviewWithText[]> {
  const schema = config.appStore.schema;

  const result = await appSequelize.query<ReviewWithText>(
    `SELECT
      canonical_review_id,
      platform,
      source_product_id,
      rating,
      review_text,
      title
     FROM "${schema}".normalized_reviews
     WHERE platform = :platform
       AND source_product_id = :sourceProductId
       AND review_date >= :start
       AND review_date <= :end
     ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC
     ${limit ? "LIMIT :limit" : ""}`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        platform,
        sourceProductId,
        start: window.start,
        end: window.end,
        ...(limit ? { limit } : {}),
      },
    },
  );

  return result;
}

/**
 * Detect whether a message contains BOTH an analysis cue and a retrieval
 * cue ("why is this product getting bad ratings AND show me the latest bad
 * reviews"). Multi-intent messages are a known, disclosed limitation: full
 * dual-execution (running both the analysis and retrieval pipelines and
 * returning both) is NOT implemented — per spec, when this is detected we
 * deliberately pick the retrieval half, since a retrieval request must never
 * come back as only statistics/prose. This is intentionally conservative,
 * not a silent drop: `multiIntentDetected` is set on the response so callers
 * know a half was skipped.
 */
function hasMultipleIntentCues(question: string): boolean {
  const q = question.toLowerCase();
  const hasRetrievalCue = /show me|show those|dikhao|get me|latest review|show evidence/.test(q);
  const hasAnalysisCue = /why|biggest|problem|issue|dikkat|complain|what should|how to fix/.test(q);
  return hasRetrievalCue && hasAnalysisCue;
}

/** Extract the last AI message's stored metadata as prior-turn context, if any. */
function deriveContextFromMessages(messages: ConversationMessage[]): PriorTurnContext | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "ai" && msg.intent) {
      return {
        intent: msg.intent as AnalyticalIntent,
        aspect: msg.aspect,
        reviewIds: msg.reviewIds,
      };
    }
  }
  return undefined;
}

async function persistTurn(
  conversationId: string | undefined,
  userQuestion: string,
  responseContent: string,
  intent: AnalyticalIntent | null,
  aspect: string | undefined,
  reviewIds: string[] | undefined,
  analysis: any,
): Promise<void> {
  if (!conversationId) return;
  const now = new Date().toISOString();
  try {
    await appendConversationMessage(conversationId, {
      role: "user",
      content: userQuestion,
      timestamp: now,
    });
    await appendConversationMessage(conversationId, {
      role: "ai",
      content: responseContent,
      timestamp: now,
      ...(analysis ? { analysis } : {}),
      ...(intent ? { intent } : {}),
      ...(aspect ? { aspect } : {}),
      ...(reviewIds ? { reviewIds } : {}),
    });
  } catch (error) {
    // Conversation persistence is best-effort state for follow-up
    // resolution — never let a persistence failure break the response
    // the user is actually waiting on.
    console.error("Failed to persist conversation turn:", error instanceof Error ? error.message : String(error));
  }
}

function buildRetrievalMessage(totalMatchingCount: number, returnedCount: number): string {
  if (returnedCount === 0) {
    return "No matching reviews found.";
  }
  if (totalMatchingCount > returnedCount) {
    return `Found ${totalMatchingCount} matching reviews. Showing the latest ${returnedCount}.`;
  }
  return `Found ${totalMatchingCount} matching review${totalMatchingCount === 1 ? "" : "s"}.`;
}

/**
 * Convert operation result into a natural language answer.
 */
function buildAnswerFromOperationResult(result: any, userQuestion: string): string {
  const operationType = result.operationType;

  if (result.status === "failure") {
    return `Unable to complete analysis: ${result.error?.message || "Unknown error"}`;
  }

  const r = result.result;

  switch (operationType) {
    case "RETRIEVE_REVIEWS":
      return buildRetrievalMessage(r?.count || 0, r?.reviews?.length || 0);
    case "ANALYZE_REVIEW_SET":
      return r?.summary || "Analysis completed.";
    case "ANALYZE_ASPECT":
      return `Aspect "${r?.aspect}" analysis: ${r?.summary || "No significant findings."}`;
    case "GET_PRODUCT_ANALYTICS":
      return `Product analytics: ${r?.reviewCount || 0} reviews, avg rating ${r?.averageRating?.toFixed(1) || "N/A"}/5.`;
    case "COMPARE_PERIODS":
      return r?.deltas?.reviewCountDelta !== undefined
        ? `Period comparison: ${r.current.window.start} to ${r.current.window.end} vs ${r.previous.window.start} to ${r.previous.window.end}. Review count delta: ${r.deltas.reviewCountDelta > 0 ? "+" : ""}${r.deltas.reviewCountDelta}.`
        : "Period comparison completed.";
    case "ANALYZE_TREND":
      return r?.summary || `Trend: ${r?.trendDirection || "unknown"}.`;
    case "GENERAL_ASSESSMENT":
      return r?.overallAssessment || "General assessment completed.";
    default:
      return "Analysis completed.";
  }
}

/**
 * Analyze a product question using verified data and AI grounding.
 * Phase 10 Step 2: Implements 30-day TTL question caching to avoid duplicate API calls.
 * Phase 10 Step 3: Detects analytical intent and performs semantic analysis when needed.
 * Phase 10 AI Product Analyst intent/context correction: branches on
 * RETRIEVAL vs ANALYSIS vs NEEDS_CLARIFICATION vs EXPLAIN_PREVIOUS before
 * ever calling the AI provider, resolving ambiguous follow-ups against
 * real conversation-state when a conversationId is supplied.
 * This is the main orchestrator for the Product Analyst feature.
 */
export async function analyzeProductQuestion(
  request: ProductAnalystRequest,
  aiProvider: AiProvider,
): Promise<ProductAnalystResponse> {
  const namedWindowFallback = request.window ?? detectWindowFromQuestion(request.userQuestion);

  // Load prior-turn context, if a conversation was supplied.
  let priorContext: PriorTurnContext | undefined;
  if (request.conversationId) {
    try {
      const conversation = await getConversation(request.conversationId);
      if (conversation) {
        priorContext = deriveContextFromMessages(conversation.messages);
      }
    } catch (error) {
      console.error("Failed to load conversation context:", error instanceof Error ? error.message : String(error));
    }
  }

  // Phase 10 semantic-query-understanding — the resolution STEP itself is now
  // an LLM call via the provider's structured resolveQuery() (queryUnderstanding.ts),
  // with round 2's deterministic regex resolver (queryResolution.ts) kept ONLY as
  // a fallback for provider failure / schema-invalid output (see resolvedViaFallback
  // on the result). `resolved` below keeps the narrower
  // {kind, intent, resolvedFromContext, clarificationPrompt} shape the rest of this
  // function was already written against — the branching structure is unchanged,
  // only what feeds it.
  const resolvedQuery: ResolvedQuery = await resolveQuerySemantic(
    request.userQuestion,
    aiProvider,
    priorContext,
    { platform: request.platform, sourceProductId: request.sourceProductId },
  );
  const resolved = resolvedQuery;

  // A resolved concrete timeframe ("last 5 days") REPLACES the fixed-set
  // window entirely — this is what makes it a real, deterministic DateWindow
  // used to query normalized_reviews, not something the LLM approximates.
  const window = resolvedQuery.timeframe?.window ?? resolveNamedWindow(namedWindowFallback);

  if (process.env.DEBUG_QUERY_RESOLUTION === "true") {
    console.log("[queryResolution]", JSON.stringify(debugResolvedQuery(resolvedQuery)));
  }

  // NEEDS_CLARIFICATION: no AI call, no DB query beyond product existence —
  // return a plain clarification response, never a guessed answer.
  if (resolved.kind === "NEEDS_CLARIFICATION") {
    const response: ProductAnalystResponse = {
      platform: request.platform,
      sourceProductId: request.sourceProductId,
      window,
      userQuestion: request.userQuestion,
      answer: resolved.clarificationPrompt ?? CLARIFICATION_PROMPT_FALLBACK,
      analysis: null,
      cacheHit: false,
      needsClarification: true,
      clarificationPrompt: resolved.clarificationPrompt ?? CLARIFICATION_PROMPT_FALLBACK,
    };
    await persistTurn(request.conversationId, request.userQuestion, response.answer, null, undefined, undefined, null);
    return response;
  }

  // Question cache: only used for context-FREE, freshly-classified turns.
  // A context-resolved answer ("show me" after "why?") is conversation-
  // specific and must never be served from a global product/window cache.
  const cacheEligible = !resolved.resolvedFromContext;
  if (cacheEligible) {
    const cached = await getCachedQuestion(request.platform, request.sourceProductId, window, request.userQuestion);
    if (cached) {
      // Bug fix (found while validating context resolution end-to-end): a
      // cache hit used to return immediately WITHOUT ever calling
      // persistTurn() — so a conversation whose first question happened to
      // already be cached (e.g. asked before, by anyone, against this
      // product/window) silently lost all conversation state. The very next
      // "show me"/"why?" follow-up would then find an empty message history
      // and incorrectly ask for clarification instead of resolving against
      // real prior context. Persisting here, reconstructed from the cached
      // response, keeps that guarantee intact regardless of cache status.
      const cachedAspect = cached.analysis?.rootCause?.[0]?.theme;
      const cachedReviewIds = cached.reviews?.map((r) => r.canonicalReviewId) ?? cached.analysis?.rootCause?.[0]?.evidenceReviewIds;
      await persistTurn(
        request.conversationId,
        request.userQuestion,
        cached.answer,
        resolvedQuery.intent,
        cachedAspect,
        cachedReviewIds,
        cached.analysis,
      );
      return cached;
    }
  }

  // Verify product exists
  const exists = await verifyProductExists(request.platform, request.sourceProductId);
  if (!exists) {
    throw new Error(`Product not found: ${request.platform}/${request.sourceProductId}`);
  }

  // PHASE C: Try semantic planner first (but NOT for context-resolved follow-ups)
  if (!resolved.resolvedFromContext) {
    try {
      const planResult = await planOperations(
        {
          userQuestion: request.userQuestion,
          platform: request.platform,
          sourceProductId: request.sourceProductId,
        },
        aiProvider,
      );

      if (planResult.status === "success") {
      // Execute the validated plan (already validated by planner)
      const validatedPlan = { ...planResult.plan, validationStatus: "valid" as const };
      const executionResult = await executeOperationPlan(
        validatedPlan,
        {
          platform: request.platform,
          sourceProductId: request.sourceProductId,
          userQuestion: request.userQuestion,
          defaultWindow: window,
        },
        { aiProvider },
      );

      if (executionResult.success && executionResult.finalResult) {
        // Build response from execution results
        const finalResult = executionResult.finalResult;
        const answerText = buildAnswerFromOperationResult(finalResult, request.userQuestion);

        const response: ProductAnalystResponse = {
          platform: request.platform,
          sourceProductId: request.sourceProductId,
          window,
          userQuestion: request.userQuestion,
          answer: answerText,
          analysis: finalResult.result as any,
          cacheHit: false,
          reviews: (finalResult.result as any)?.reviews || null,
        };

        // Persist the turn for conversation context
        await persistTurn(
          request.conversationId,
          request.userQuestion,
          answerText,
          resolvedQuery.intent,
          (finalResult.result as any)?.aspect,
          executionResult.allEvidenceReviewIds,
          finalResult.result as any,
        );

        if (cacheEligible) {
          await cacheQuestion(request.platform, request.sourceProductId, window, request.userQuestion, response);
        }

        return response;
      }
      }
    } catch (error) {
      // Planner failed — fall through to queryResolution path
      if (process.env.DEBUG_PLANNER === "true") {
        console.log("[planner] fallback:", error instanceof Error ? error.message : String(error));
      }
    }
  }

  const multiIntentDetected = hasMultipleIntentCues(request.userQuestion);

  // ---------- RETRIEVAL PATH: never touches the AI provider ----------
  if (resolved.kind === "RETRIEVAL") {
    const derivedFilters = deriveReviewFiltersFromQuestion(request.userQuestion);
    // Context-resolved bare "show me" reuses the prior aspect as a theme hint
    // when the question itself carried no explicit filter. Compositional
    // extraction (Phase 10 query-understanding correction): action, timeframe,
    // sentiment, quantity and aspect were all extracted simultaneously by
    // resolveQuery() above — a resolved timeframe here actually overrides the
    // window passed to retrieveReviews() instead of being invisible to it.
    const theme = derivedFilters.theme ?? resolvedQuery.filters.theme ?? (resolvedQuery.resolvedFromContext ? resolvedQuery.aspect ?? undefined : undefined);
    const retrievalWindow = resolvedQuery.timeframe?.window ?? request.window ?? detectWindowFromQuestion(request.userQuestion);

    // A context-resolved follow-up ("show me" after an analysis turn) grounds
    // to the EXACT, already-validated review IDs the prior turn cited, not a
    // re-derived theme-column filter — a semantically-discovered aspect (e.g.
    // "quality_issue") was never persisted to review_theme (that table is
    // scoped to the fixed THEME_VOCABULARY only), so filtering by theme name
    // alone would silently return zero rows even though real evidence exists.
    const contextReviewIds =
      resolvedQuery.resolvedFromContext && priorContext?.aspect === theme ? priorContext?.reviewIds : undefined;

    const { reviews, totalMatchingCount, requestedLimit } = await retrieveReviews({
      platform: request.platform,
      sourceProductId: request.sourceProductId,
      window: retrievalWindow,
      limit: resolvedQuery.quantity ?? derivedFilters.limit,
      rating: derivedFilters.rating ?? resolvedQuery.filters.rating,
      sentiment: derivedFilters.sentiment ?? resolvedQuery.filters.sentiment ?? resolvedQuery.sentiment ?? undefined,
      theme,
      reviewIds: contextReviewIds,
    });

    const message = buildRetrievalMessage(totalMatchingCount, reviews.length);
    const reviewIds = reviews.map((r) => r.canonicalReviewId);

    const response: ProductAnalystResponse = {
      platform: request.platform,
      sourceProductId: request.sourceProductId,
      window,
      userQuestion: request.userQuestion,
      answer: message,
      analysis: null,
      cacheHit: false,
      reviews,
      totalMatchingCount,
      requestedLimit,
      ...(multiIntentDetected
        ? { multiIntentDetected: true, multiIntentNote: "Analysis half of this multi-intent question was not executed; retrieval was prioritized." }
        : {}),
    };

    await persistTurn(
      request.conversationId,
      request.userQuestion,
      message,
      AnalyticalIntent.REVIEW_EXPLORATION,
      theme,
      reviewIds,
      null,
    );

    if (cacheEligible) {
      await cacheQuestion(request.platform, request.sourceProductId, window, request.userQuestion, response);
    }

    return response;
  }

  // ---------- EXPLAIN_PREVIOUS: reuse the same evidence, no new pass ----------
  if (resolved.kind === "EXPLAIN_PREVIOUS" && priorContext) {
    const evidencePackage = await buildProductEvidencePackage(request.platform, request.sourceProductId, window);
    const aspect = priorContext.aspect;
    const priorReviewIds = priorContext.reviewIds ?? [];
    const { valid: validatedIds } = await validateEvidenceReviewIds(priorReviewIds, request.platform, request.sourceProductId);

    const explanation = aspect
      ? `The previously identified root cause was "${aspect}", based on ${validatedIds.length} supporting review(s) from this window. ${evidencePackage.reviewCount > 0 ? `Overall ${evidencePackage.reviewCount} reviews were analyzed for this product in the selected window.` : ""}`.trim()
      : "No prior root cause is available to explain further — ask a new question about this product.";

    const result = aspect
      ? {
          summary: explanation,
          rootCause: [{ theme: aspect, explanation, evidenceReviewIds: validatedIds }],
          recommendations: [],
          rejectedCitations: [],
          irrelevantCitations: [],
          droppedUnsupportedClaims: 0,
          citedMetrics: [],
          ungroundedMetrics: [],
        }
      : null;

    const response: ProductAnalystResponse = {
      platform: request.platform,
      sourceProductId: request.sourceProductId,
      window,
      userQuestion: request.userQuestion,
      answer: explanation,
      analysis: result as any,
      cacheHit: false,
    };

    await persistTurn(
      request.conversationId,
      request.userQuestion,
      explanation,
      priorContext.intent,
      aspect,
      validatedIds,
      result,
    );

    return response;
  }

  // ---------- ANALYSIS PATH: existing semantic-analysis + narrator pipeline ----------
  const intent = (resolved.intent ?? detectIntent(request.userQuestion)) as AnalyticalIntent;

  // Retrieve reviews with full text and perform semantic analysis if needed
  const reviews = await getReviewsWithText(request.platform, request.sourceProductId, window);

  let semanticAnalysisData: any = null;
  if (!isRetrievalIntent(intent) && intent !== AnalyticalIntent.STATS_QUERY && reviews.length > 0) {
    try {
      semanticAnalysisData = await analyzeProductReviewsForIntent(reviews, intent, aiProvider);
    } catch (error) {
      console.error("Semantic analysis failed:", error instanceof Error ? error.message : String(error));
      // Continue without semantic analysis; narrator will use theme-based approach
    }
  }

  // Build the evidence package (this contains all verified data about the product)
  const evidencePackage = await buildProductEvidencePackage(request.platform, request.sourceProductId, window);

  // Build deterministic evidence from semantic analysis.
  // Backend owns the evidence count and review IDs, NOT the AI.
  let deterministicRootCause: any = null;
  if (semanticAnalysisData && semanticAnalysisData.aspects.length > 0) {
    (evidencePackage as any).topNegativeThemes = semanticAnalysisData.aspects.map((aspect: any) => ({
      theme: aspect.aspect,
      count: aspect.count,
    }));
    (evidencePackage as any).semanticAnalysis = semanticAnalysisData;

    // Augment reviewThemes with semantic-discovered aspects for citation grounding
    for (const aspect of semanticAnalysisData.aspects) {
      for (const reviewId of aspect.reviewIds) {
        evidencePackage.reviewThemes[reviewId] ??= [];
        if (!evidencePackage.reviewThemes[reviewId].includes(aspect.aspect)) {
          evidencePackage.reviewThemes[reviewId].push(aspect.aspect);
        }
      }
    }

    // Build deterministic root cause from semantic analysis
    // This is the source of truth for evidence counts
    deterministicRootCause = await buildDeterministicRootCause(
      semanticAnalysisData.aspects,
      request.platform,
      request.sourceProductId,
    );

    // Validate evidence integrity BEFORE narrator
    if (deterministicRootCause) {
      const validation = validateEvidenceIntegrity(
        deterministicRootCause.aspect,
        deterministicRootCause.count,
        deterministicRootCause.reviewIds,
      );
      if (!validation.valid) {
        console.error("Evidence integrity violation:", validation.errors);
      }
    }
  }

  // Use the narrator to generate a grounded analysis
  // Pass question and intent so the provider can contextualize the response
  const result = await narrateProductEvidence(evidencePackage, aiProvider, request.userQuestion, intent);

  // CRITICAL: If we have deterministic evidence, it MUST be preserved.
  // The narrator's citations should not reduce the deterministic count.
  // Bug #3 fix: with `theme` no longer forced into a fixed enum, a
  // discovered aspect CAN now appear as its own rootCause entry — so if no
  // narrator entry matches, we ADD the deterministic root cause as its own
  // backend-constructed entry instead of overwriting an unrelated,
  // wrongly-labeled narrator entry with the wrong theme's evidence.
  if (deterministicRootCause && deterministicRootCause.reviewIds) {
    const narratedRootCause = result.rootCause?.find(
      (rc: any) =>
        rc.theme.toLowerCase() === deterministicRootCause.aspect.toLowerCase() ||
        rc.theme === deterministicRootCause.aspect,
    );

    if (narratedRootCause) {
      // ENFORCE: Deterministic evidence IDs are the authority.
      // Do not let narrator reduce them.
      narratedRootCause.evidenceReviewIds = [...deterministicRootCause.reviewIds];
    } else {
      // No narrator entry named this aspect — add it as its own entry
      // rather than mislabeling a different (fixed-theme) entry.
      result.rootCause = result.rootCause ?? [];
      result.rootCause.push({
        theme: deterministicRootCause.aspect,
        explanation: deterministicRootCause.explanation,
        evidenceReviewIds: [...deterministicRootCause.reviewIds],
      });
    }
  }

  // Final integrity check
  for (const rc of result.rootCause ?? []) {
    const validation = validateEvidenceIntegrity(rc.theme, rc.evidenceReviewIds.length, rc.evidenceReviewIds);
    if (!validation.valid) {
      console.error(`Final validation failed for "${rc.theme}":`, validation.errors);
    }
  }

  const topAspect = deterministicRootCause?.aspect ?? result.rootCause?.[0]?.theme;
  const topReviewIds = result.rootCause?.[0]?.evidenceReviewIds ?? [];

  const response: ProductAnalystResponse = {
    platform: request.platform,
    sourceProductId: request.sourceProductId,
    window,
    userQuestion: request.userQuestion,
    answer: result.summary, // Primary answer is the summary
    analysis: result, // Full analysis with root causes, recommendations, citations
    cacheHit: false,
    ...(multiIntentDetected
      ? { multiIntentDetected: true, multiIntentNote: "Retrieval half of this multi-intent question was not executed; analysis was returned." }
      : {}),
  };

  await persistTurn(request.conversationId, request.userQuestion, result.summary, intent, topAspect, topReviewIds, result);

  // Cache the validated result (never raw model output) — only for
  // context-free turns (see cacheEligible above).
  if (cacheEligible) {
    await cacheQuestion(request.platform, request.sourceProductId, window, request.userQuestion, response);
  }

  return response;
}
