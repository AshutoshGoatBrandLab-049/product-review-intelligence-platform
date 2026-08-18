import { z } from "zod";
import type { AiProvider } from "./providers/aiProvider.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { PriorTurnContext } from "./intentDetection.js";
import { AnalyticalIntent } from "./intentDetection.js";
import {
  QUERY_ACTIONS,
  type QueryAction,
  type ResolvedQuery,
  resolveQuery,
  actionToIntent,
  kindForAction,
  CLARIFICATION_PROMPT,
} from "./queryResolution.js";
import { resolveTimeframeDescriptor, type TimeframeDescriptor } from "./timeframeResolution.js";

/**
 * Phase 10 semantic-query-understanding architecture.
 *
 * Why round 2's compositional-regex resolver (queryResolution.ts) still does
 * not satisfy the actual requirement: it decomposes a message into several
 * independent dimensions instead of one whole-message classification, which
 * fixed several concrete bugs (see that file's header) — but every dimension
 * is still matched via a fixed regex/keyword list. It cannot generalize to a
 * genuinely novel paraphrase whose wording the authors never anticipated; it
 * can only be widened by someone adding another pattern after the fact, which
 * is the exact anti-pattern the requirement rules out. A compositional
 * keyword list is still a keyword list.
 *
 * This module moves the UNDERSTANDING step itself to the LLM, via
 * structured/function-calling output (never free text) — mirroring the exact
 * trust boundary narrator.ts already enforces for citations: the model
 * chooses WHICH closed bucket a request belongs to and extracts a small set
 * of STRUCTURAL parameters (a timeframe descriptor, not a date; a sentiment
 * label; a quantity; an aspect string) — it never computes a date, a review
 * ID, or a count itself. All of those stay 100% deterministic, computed by
 * the backend from the LLM's structured decision, exactly as they were
 * before this change (resolveTimeframeDescriptor() below reuses the same
 * date-math helpers timeframeResolution.ts already had; retrieveReviews()/
 * deriveReviewFiltersFromQuestion() are untouched).
 *
 * If the real LLM call fails, or returns output that fails schema
 * validation, this module falls back to round 2's deterministic regex
 * resolver so the app degrades gracefully — but the result is tagged
 * `resolvedViaFallback: true` so nothing downstream can mistake a degraded
 * response for real semantic understanding.
 */

export interface QueryResolutionInput {
  userQuestion: string;
  conversationContext: {
    lastAction: QueryAction | null;
    lastAspect: string | null;
    lastTimeframe: TimeframeDescriptor | null;
    lastReviewIds: string[] | null;
  };
  productContext: {
    platform: Platform;
    sourceProductId: string;
  };
}

const TimeframeDescriptorSchema = z.object({
  type: z.enum(["RELATIVE", "ABSOLUTE", "NAMED", "NONE"]),
  value: z.number().positive().nullable().optional(),
  unit: z.enum(["day", "week", "month", "year"]).nullable().optional(),
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});

/**
 * The ONLY shape ever accepted from a provider's resolveQuery() call — raw
 * output is parsed through this schema before anything downstream sees it,
 * same discipline as AiAnalysisOutputSchema (types.ts) and narrator.ts's
 * validation. A malformed/out-of-enum response fails validation and falls
 * back to the deterministic resolver rather than being coerced.
 */
export const ResolvedQueryLlmOutputSchema = z.object({
  action: z.enum(QUERY_ACTIONS),
  timeframeDescriptor: TimeframeDescriptorSchema,
  sentiment: z.enum(["positive", "negative", "neutral"]).nullable(),
  quantity: z.number().positive().nullable(),
  aspect: z.string().max(80).nullable(),
  contextReference: z.boolean(),
  responseStyle: z.enum(["CONCISE", "DETAILED", "DEFAULT"]),
  reasoning: z.string().max(1000),
});

export type ResolvedQueryLlmOutput = z.infer<typeof ResolvedQueryLlmOutputSchema>;

function intentToApproxAction(intent: AnalyticalIntent): QueryAction | null {
  switch (intent) {
    case AnalyticalIntent.REVIEW_EXPLORATION:
      return "RETRIEVE_REVIEWS";
    case AnalyticalIntent.EVIDENCE_RETRIEVAL:
      return "RETRIEVE_EVIDENCE";
    case AnalyticalIntent.TOP_PROBLEM:
      return "ANALYZE_PROBLEM";
    case AnalyticalIntent.COMPLAINT_ANALYSIS:
      return "ANALYZE_COMPLAINTS";
    case AnalyticalIntent.POSITIVE_FEEDBACK:
      return "ANALYZE_POSITIVE_FEEDBACK";
    case AnalyticalIntent.RATING_DECLINE:
      return "ANALYZE_RATINGS";
    case AnalyticalIntent.TIME_COMPARISON:
      return "COMPARE_PERIODS";
    case AnalyticalIntent.RECOMMENDATION:
      return "RECOMMEND_IMPROVEMENTS";
    case AnalyticalIntent.STATS_QUERY:
      return "SHOW_STATISTICS";
    default:
      return null;
  }
}

/**
 * Converts the LLM's validated structured output into the same ResolvedQuery
 * shape productAnalyst.ts already branches on (round 1/2's shape, unchanged)
 * — so the orchestrator's downstream branching needed zero structural
 * changes, only a different function feeding it.
 */
function llmOutputToResolvedQuery(
  parsed: ResolvedQueryLlmOutput,
  priorContext: PriorTurnContext | undefined,
): ResolvedQuery {
  // Backend-side authority check: the LLM claiming a contextual/pronoun
  // reference ("it"/"that"/"those") is only actionable if a real prior turn
  // actually exists server-side. The model's belief that context exists is
  // never sufficient on its own — same "AI never computes facts" boundary
  // narrator.ts enforces for citations, applied here to conversation state.
  if (parsed.contextReference && !priorContext) {
    return {
      action: "CLARIFY",
      intent: null,
      kind: "NEEDS_CLARIFICATION",
      subject: "PRODUCT",
      filters: {},
      timeframe: null,
      quantity: parsed.quantity,
      aspect: null,
      sentiment: parsed.sentiment,
      comparison: null,
      contextReference: true,
      responseStyle: parsed.responseStyle,
      resolvedFromContext: false,
      resolvedViaFallback: false,
      clarificationPrompt: CLARIFICATION_PROMPT,
    };
  }

  const action = parsed.action;
  const timeframe = resolveTimeframeDescriptor(parsed.timeframeDescriptor);
  // Pronoun/contextual-reference resolution: when the model flagged this as
  // referring to a prior turn but didn't (or couldn't) restate the aspect
  // itself, inherit the aspect the prior turn actually established.
  const aspect = parsed.aspect ?? (parsed.contextReference ? priorContext?.aspect ?? null : null);
  const intent =
    action === "EXPLAIN_PREVIOUS_RESULT" && priorContext ? priorContext.intent : actionToIntent(action);

  return {
    action,
    intent,
    kind: kindForAction(action),
    subject: action === "RETRIEVE_REVIEWS" || action === "RETRIEVE_EVIDENCE" ? "REVIEWS" : "PRODUCT",
    filters: { sentiment: parsed.sentiment ?? undefined, theme: aspect ?? undefined },
    timeframe,
    quantity: parsed.quantity,
    aspect,
    sentiment: parsed.sentiment,
    comparison: null,
    contextReference: parsed.contextReference,
    responseStyle: parsed.responseStyle,
    resolvedFromContext: parsed.contextReference,
    resolvedViaFallback: false,
    ...(action === "CLARIFY" ? { clarificationPrompt: CLARIFICATION_PROMPT } : {}),
  };
}

/**
 * Primary query-understanding entry point. Calls the AI provider's
 * structured `resolveQuery()`; on any failure — provider error (rate limit,
 * timeout, auth), or output that fails ResolvedQueryLlmOutputSchema
 * validation — falls back to the deterministic regex resolver
 * (queryResolution.ts's resolveQuery(), round 2's work, unmodified) so the
 * app degrades gracefully instead of hard-failing the request. The fallback
 * result is explicitly tagged `resolvedViaFallback: true`.
 */
export async function resolveQuerySemantic(
  question: string,
  aiProvider: AiProvider,
  priorContext: PriorTurnContext | undefined,
  productContext: { platform: Platform; sourceProductId: string },
): Promise<ResolvedQuery> {
  try {
    const input: QueryResolutionInput = {
      userQuestion: question,
      conversationContext: {
        lastAction: priorContext ? intentToApproxAction(priorContext.intent) : null,
        lastAspect: priorContext?.aspect ?? null,
        lastTimeframe: null,
        lastReviewIds: priorContext?.reviewIds ?? null,
      },
      productContext,
    };

    if (!aiProvider.resolveQuery) {
      throw new Error(`AiProvider "${aiProvider.name}" does not implement resolveQuery()`);
    }

    const raw = await aiProvider.resolveQuery(input);
    const parsed = ResolvedQueryLlmOutputSchema.parse(raw);
    return llmOutputToResolvedQuery(parsed, priorContext);
  } catch (error) {
    console.error(
      "[queryUnderstanding] LLM query resolution failed — falling back to deterministic resolver:",
      error instanceof Error ? error.message : String(error),
    );
    const fallback = resolveQuery(question, priorContext);
    return { ...fallback, resolvedViaFallback: true };
  }
}
