/**
 * Phase 10 query-understanding correction — compositional query resolution.
 *
 * Replaces "classify the whole message into one AnalyticalIntent enum value"
 * with a decomposition into independent semantic dimensions BEFORE deciding
 * what to do. `action` is the new primary dispatch key (RETRIEVE_REVIEWS vs
 * ANALYZE_* vs RECOMMEND_IMPROVEMENTS vs CLARIFY, etc.) — separate from the
 * legacy `AnalyticalIntent` enum, which is still produced (via `intent`)
 * because the existing narrator/semantic-analysis plumbing keys off it.
 *
 * Confirmed root causes this module fixes (verified by reading the code in
 * a prior pass, not re-derived here):
 *   1. detectIntent() had zero timeframe recognition, so "mujhe last 5 days
 *      ka reviews dekhna h" matched no branch and fell through to STATS_QUERY.
 *      detectWindowFromQuestion() also only recognized the fixed 7/30/60/90/
 *      180/365 set via literal substring match — arbitrary N was invisible.
 *   2. RECOMMENDATION only matched the exact substring "how can we improve";
 *      "how can improve this product" (no "we") fell through to STATS_QUERY.
 */

import { AnalyticalIntent } from "./intentDetection.js";
import type { PriorTurnContext } from "./intentDetection.js";
import { resolveTimeframeFromQuestion, type ResolvedTimeframe } from "./timeframeResolution.js";
import { deriveReviewFiltersFromQuestion } from "../analytics/reviewRetrieval.js";

/**
 * Closed action taxonomy. Phase 10 semantic-query-understanding: this same
 * const array is reused as the enum surfaced to the LLM in the
 * function-calling/structured-output tool schema (see
 * providers/openaiProvider.ts's QUERY_RESOLUTION_TOOL et al.) — the model
 * chooses WHICH bucket, it can never invent a new one, because the schema
 * itself is generated from this array.
 */
export const QUERY_ACTIONS = [
  "RETRIEVE_REVIEWS",
  "ANALYZE_PROBLEM",
  "ANALYZE_COMPLAINTS",
  "ANALYZE_POSITIVE_FEEDBACK",
  "ANALYZE_RATINGS",
  "COMPARE_PERIODS",
  "ANALYZE_TREND",
  "RECOMMEND_IMPROVEMENTS",
  "EXPLAIN_PREVIOUS_RESULT",
  "RETRIEVE_EVIDENCE",
  "SHOW_STATISTICS",
  "COMPARE_MARKETPLACES",
  "CLARIFY",
] as const;

export type QueryAction = (typeof QUERY_ACTIONS)[number];

export type ResolvedQueryKind = "RETRIEVAL" | "ANALYSIS" | "NEEDS_CLARIFICATION" | "EXPLAIN_PREVIOUS";

export interface ResolvedQuery {
  action: QueryAction;
  /** Legacy dispatch key, kept because the narrator/semantic-analysis pipeline still keys off it. Null only for CLARIFY. */
  intent: AnalyticalIntent | null;
  kind: ResolvedQueryKind;
  subject: "REVIEWS" | "PRODUCT";
  filters: { rating?: number; sentiment?: "positive" | "neutral" | "negative"; theme?: string };
  timeframe: ResolvedTimeframe | null;
  quantity: number | null;
  aspect: string | null;
  sentiment: "positive" | "negative" | "neutral" | null;
  comparison: null;
  contextReference: boolean;
  responseStyle: "CONCISE" | "DETAILED" | "DEFAULT";
  resolvedFromContext: boolean;
  /**
   * Phase 10 semantic-query-understanding — true only when this resolution
   * came from the deterministic regex resolver in THIS file because the real
   * LLM-based resolution (queryUnderstanding.ts's resolveQuerySemantic())
   * failed or returned output that failed schema validation. Never set true
   * for a successful LLM resolution — callers must not conflate a degraded
   * fallback with real semantic understanding.
   */
  resolvedViaFallback?: boolean;
  clarificationPrompt?: string;
}

export const CLARIFICATION_PROMPT =
  "What would you like me to show — the latest reviews, supporting evidence, or the product analysis?";

const ANAPHORIC_PATTERNS = [
  /^show me$/,
  /^show those$/,
  /^those reviews$/,
  /^show them$/,
  /^why\??$/,
  /^why is that\??$/,
  /^explain$/,
  /^explain more$/,
  /^explain in detail$/,
  /^what about them\??$/,
  /^what about (it|that|those)\??$/,
  /^tell me more$/,
  /^(latest|top|first|last)\s+\d+$/,
];

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/[.,!]+$/g, "");
}

/**
 * A message is ambiguous/anaphoric only if it matches one of the fixed
 * bare-pronoun patterns, OR is very short AND carries no concrete action
 * signal of its own — a short message that already names a retrieval verb
 * ("reviews dekhna hai", 3 words) must resolve on its own, not be forced
 * through context-resolution (which would CLARIFY when no prior turn exists).
 */
function isShortOrAnaphoric(question: string, hasConcreteActionSignal: boolean): boolean {
  const q = normalize(question);
  if (ANAPHORIC_PATTERNS.some((p) => p.test(q))) return true;
  if (hasConcreteActionSignal) return false;
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  return wordCount <= 3;
}

function isExplainPrevious(question: string): boolean {
  const q = normalize(question);
  return /^why\??$/.test(q) || /^why is that\??$/.test(q) || /^explain( more| in detail)?$/.test(q);
}

// --- Action-phrase recognizers -------------------------------------------

/** Explicit retrieval verbs, English + Hinglish, per spec §5. */
const RETRIEVAL_VERB_RE =
  /\b(?:show me|show those|show the|get me|give me|dikhao|dikha do|dikhaiye|dekhna h|dekhna hai|dekhna|batao|nikalo|de do)\b/;

const RETRIEVAL_NOUN_RE = /\b(?:review|reviews)\b/;

const RETRIEVAL_PHRASE_RE =
  /\b(?:latest review|recent review|list review|reviews from|1-star|1 star|5-star|5 star|best review|worst review|give me the best|give me the worst)\b/;

/** Loosened per spec — word-order/pronoun variance must not defeat the match. */
const RECOMMENDATION_RE =
  /\bhow\s+(?:can|do|could|to)\b(?:\s+\w+){0,3}?\s*\b(?:improve|fix)\b|\bwhat\s+should\b(?:\s+\w+){0,4}?\s*\b(?:improve|fix|change)\b|\bwhat\s+changes\s+should\b/;

const TOP_PROBLEM_RE =
  /\b(?:biggest issue|biggest problem|main problem|main issue|most unhappy|hurting this|what'?s wrong|what is wrong|top problem|sabse badi|sabse bada|kya dikkat|kya problem|scene hai|scene h|kya scene)\b/;

const COMPLAINT_RE =
  /\b(?:complain\w*|complaint\w*|problems customers|customer problems|customers mention|what mention|negative|bad|dikkat|pareshan|kharaab|kharab|problem)\b/;

const POSITIVE_RE =
  /\b(?:like|love|happy|satisfied|appreciate|positive|good about|achhe|acche|badhiya)\b/;

const EVIDENCE_RE = /\b(?:evidence|supporting review|show evidence)\b/;

const RATING_DECLINE_RE = /\b(?:rating low|rating decline|why rating|why low|rating drop|why is the rating)\b/;

const TIME_COMPARISON_RE = /\b(?:change|changed|recently|vs |versus|compare|compared to)\b/;

function detectSentiment(question: string): "positive" | "negative" | "neutral" | null {
  const derived = deriveReviewFiltersFromQuestion(question);
  return derived.sentiment ?? null;
}

function detectQuantity(question: string): number | null {
  const derived = deriveReviewFiltersFromQuestion(question);
  return derived.limit ?? null;
}

export function actionToIntent(action: QueryAction): AnalyticalIntent | null {
  switch (action) {
    case "RETRIEVE_REVIEWS":
      return AnalyticalIntent.REVIEW_EXPLORATION;
    case "RETRIEVE_EVIDENCE":
      return AnalyticalIntent.EVIDENCE_RETRIEVAL;
    case "ANALYZE_PROBLEM":
      return AnalyticalIntent.TOP_PROBLEM;
    case "ANALYZE_COMPLAINTS":
      return AnalyticalIntent.COMPLAINT_ANALYSIS;
    case "ANALYZE_POSITIVE_FEEDBACK":
      return AnalyticalIntent.POSITIVE_FEEDBACK;
    case "ANALYZE_RATINGS":
      return AnalyticalIntent.RATING_DECLINE;
    case "COMPARE_PERIODS":
    case "ANALYZE_TREND":
      return AnalyticalIntent.TIME_COMPARISON;
    case "RECOMMEND_IMPROVEMENTS":
      return AnalyticalIntent.RECOMMENDATION;
    case "SHOW_STATISTICS":
    case "COMPARE_MARKETPLACES":
      return AnalyticalIntent.STATS_QUERY;
    case "EXPLAIN_PREVIOUS_RESULT":
    case "CLARIFY":
      return null;
  }
}

export function kindForAction(action: QueryAction): ResolvedQueryKind {
  if (action === "CLARIFY") return "NEEDS_CLARIFICATION";
  if (action === "EXPLAIN_PREVIOUS_RESULT") return "EXPLAIN_PREVIOUS";
  if (action === "RETRIEVE_REVIEWS" || action === "RETRIEVE_EVIDENCE") return "RETRIEVAL";
  return "ANALYSIS";
}

/**
 * Classifies the primary action for a message in isolation (no prior-turn
 * context applied yet — see resolveQuery() for the context-aware wrapper).
 * Priority order preserved from the previously-working classifier:
 * explicit retrieval verbs/phrases first (so "show me the bad reviews"
 * resolves to retrieval, not COMPLAINT_ANALYSIS via the word "bad"), then
 * RECOMMEND_IMPROVEMENTS, then analytical keywords, then a fallback to
 * statistics.
 */
function classifyAction(question: string, timeframe: ResolvedTimeframe | null): QueryAction {
  const q = question.toLowerCase();

  // Belt-and-suspenders per spec item 2: either an explicit retrieval verb/
  // phrase, OR a recognized timeframe expression combined with a review noun,
  // resolves to RETRIEVE_REVIEWS.
  if (RETRIEVAL_VERB_RE.test(q) || RETRIEVAL_PHRASE_RE.test(q)) {
    return "RETRIEVE_REVIEWS";
  }
  if (timeframe && RETRIEVAL_NOUN_RE.test(q)) {
    return "RETRIEVE_REVIEWS";
  }

  // RECOMMENDATION checked before TOP_PROBLEM: "what should we fix first" is
  // an explicit spec-mandated RECOMMEND_IMPROVEMENTS trigger phrase, and
  // would otherwise be shadowed by TOP_PROBLEM's more generic "fix"-adjacent
  // matching.
  if (RECOMMENDATION_RE.test(q)) return "RECOMMEND_IMPROVEMENTS";
  if (TOP_PROBLEM_RE.test(q)) return "ANALYZE_PROBLEM";
  if (COMPLAINT_RE.test(q)) return "ANALYZE_COMPLAINTS";
  if (POSITIVE_RE.test(q)) return "ANALYZE_POSITIVE_FEEDBACK";
  if (EVIDENCE_RE.test(q)) return "RETRIEVE_EVIDENCE";
  if (RATING_DECLINE_RE.test(q)) return "ANALYZE_RATINGS";
  if (TIME_COMPARISON_RE.test(q)) return "COMPARE_PERIODS";

  return "SHOW_STATISTICS";
}

function detectResponseStyle(question: string): "CONCISE" | "DETAILED" | "DEFAULT" {
  const q = question.toLowerCase();
  if (/\bin detail\b|\bexplain in detail\b|\bmore detail\b|\belaborate\b/.test(q)) return "DETAILED";
  if (/\bbriefly\b|\bshort answer\b|\bquick(ly)?\b|\btl;?dr\b/.test(q)) return "CONCISE";
  return "DEFAULT";
}

/**
 * Compositional resolution: decomposes a message into action + filters +
 * timeframe + quantity + aspect + sentiment SIMULTANEOUSLY, then applies
 * prior-turn context for short/anaphoric follow-ups. This is the function
 * productAnalyst.ts's orchestrator now calls instead of
 * resolveIntentWithContext() alone (that function is kept for direct unit
 * testing / backward compatibility of the narrower legacy behavior).
 */
export function resolveQuery(question: string, priorContext?: PriorTurnContext): ResolvedQuery {
  const timeframe = resolveTimeframeFromQuestion(question);
  const derivedFilters = deriveReviewFiltersFromQuestion(question);
  const sentiment = detectSentiment(question);
  const quantity = detectQuantity(question);
  const responseStyle = detectResponseStyle(question);
  const rawAction = classifyAction(question, timeframe);
  const ambiguous = isShortOrAnaphoric(question, rawAction !== "SHOW_STATISTICS");

  if (!ambiguous) {
    const action = rawAction;
    const intent = actionToIntent(action);
    return {
      action,
      intent,
      kind: kindForAction(action),
      subject: action === "RETRIEVE_REVIEWS" || action === "RETRIEVE_EVIDENCE" ? "REVIEWS" : "PRODUCT",
      filters: { rating: derivedFilters.rating, sentiment: derivedFilters.sentiment, theme: derivedFilters.theme },
      timeframe,
      quantity,
      aspect: derivedFilters.theme ?? null,
      sentiment,
      comparison: null,
      contextReference: false,
      responseStyle,
      resolvedFromContext: false,
    };
  }

  // Ambiguous/short message: resolve using prior context, same priority
  // ordering the previously-working context resolver used.
  if (!priorContext) {
    return {
      action: "CLARIFY",
      intent: null,
      kind: "NEEDS_CLARIFICATION",
      subject: "PRODUCT",
      filters: {},
      timeframe,
      quantity,
      aspect: null,
      sentiment,
      comparison: null,
      contextReference: true,
      responseStyle,
      resolvedFromContext: false,
      clarificationPrompt: CLARIFICATION_PROMPT,
    };
  }

  if (isExplainPrevious(question)) {
    return {
      action: "EXPLAIN_PREVIOUS_RESULT",
      intent: priorContext.intent,
      kind: "EXPLAIN_PREVIOUS",
      subject: "PRODUCT",
      filters: {},
      timeframe,
      quantity,
      aspect: priorContext.aspect ?? null,
      sentiment,
      comparison: null,
      contextReference: true,
      responseStyle,
      resolvedFromContext: true,
    };
  }

  // "show me" / "show those" / bare number after context exists: resolve as
  // retrieval FOR the prior turn's aspect (if the prior turn was analysis) or
  // repeat retrieval (if the prior turn was itself retrieval) — spec item 7.
  const priorWasRetrieval =
    priorContext.intent === AnalyticalIntent.REVIEW_EXPLORATION || priorContext.intent === AnalyticalIntent.EVIDENCE_RETRIEVAL;
  const looksLikeRetrievalFollowup = /show|latest|top|first|last/.test(question.toLowerCase());
  const action: QueryAction = priorWasRetrieval || looksLikeRetrievalFollowup ? "RETRIEVE_REVIEWS" : "ANALYZE_PROBLEM";

  return {
    action,
    intent: action === "RETRIEVE_REVIEWS" ? AnalyticalIntent.REVIEW_EXPLORATION : priorContext.intent,
    kind: kindForAction(action),
    subject: action === "RETRIEVE_REVIEWS" ? "REVIEWS" : "PRODUCT",
    filters: { theme: priorContext.aspect },
    timeframe,
    quantity,
    aspect: priorContext.aspect ?? null,
    sentiment,
    comparison: null,
    contextReference: true,
    responseStyle,
    resolvedFromContext: true,
  };
}

/** Small, loggable debug view of a resolved query — spec §17/§23 (internal, not API-facing). */
export function debugResolvedQuery(rq: ResolvedQuery) {
  return {
    action: rq.action,
    intent: rq.intent,
    filters: rq.filters,
    timeframe: rq.timeframe ? { type: rq.timeframe.type, unit: rq.timeframe.unit, value: rq.timeframe.value, window: rq.timeframe.window } : null,
    quantity: rq.quantity,
    aspect: rq.aspect,
    sentiment: rq.sentiment,
    contextReference: rq.contextReference,
    resolvedFromContext: rq.resolvedFromContext,
    responseStyle: rq.responseStyle,
    resolvedViaFallback: rq.resolvedViaFallback ?? false,
  };
}
