/**
 * Phase 10 Step 3 — Intent detection from natural language questions.
 * Deterministic classification of analytical intent without ML.
 */

export enum AnalyticalIntent {
  TOP_PROBLEM = "TOP_PROBLEM",
  COMPLAINT_ANALYSIS = "COMPLAINT_ANALYSIS",
  POSITIVE_FEEDBACK = "POSITIVE_FEEDBACK",
  RATING_DECLINE = "RATING_DECLINE",
  TIME_COMPARISON = "TIME_COMPARISON",
  REVIEW_EXPLORATION = "REVIEW_EXPLORATION",
  EVIDENCE_RETRIEVAL = "EVIDENCE_RETRIEVAL",
  RECOMMENDATION = "RECOMMENDATION",
  STATS_QUERY = "STATS_QUERY",
}

/**
 * Retrieval intents return actual review records from the DB.
 * Analysis intents run the semantic-analysis + narrator pipeline.
 */
const RETRIEVAL_INTENTS = new Set<AnalyticalIntent>([
  AnalyticalIntent.REVIEW_EXPLORATION,
  AnalyticalIntent.EVIDENCE_RETRIEVAL,
]);

export function isRetrievalIntent(intent: AnalyticalIntent): boolean {
  return RETRIEVAL_INTENTS.has(intent);
}

/**
 * Detect analytical intent from user's natural language question.
 * More specific intents take precedence over generic STATS_QUERY.
 * Deterministic, testable, no ML required.
 *
 * Covers English plus a real (if non-exhaustive) set of Hinglish / Roman
 * Hindi terms taken directly from the spec's literal example phrases
 * ("dikkat", "dikhao", "kharaab"/"kharab", "sabse badi", "pareshan",
 * "scene kya hai", etc.) — this is still a keyword classifier, not an ML
 * system; it is only extending the keyword list's language coverage.
 */
export function detectIntent(question: string): AnalyticalIntent {
  const q = question.toLowerCase().trim();

  // REVIEW_EXPLORATION (highest priority — explicit data request)
  // Must be checked first because it's a direct action ("show me", "get me",
  // "dikhao") that should not be overridden by analytical keywords like "bad".
  if (
    q.includes("show me") ||
    q.includes("show those") ||
    q.includes("show the") ||
    q.includes("get me") ||
    q.includes("latest review") ||
    q.includes("recent review") ||
    q.includes("list review") ||
    q.includes("reviews from") ||
    (q.includes("1-star") || q.includes("1 star")) ||
    (q.includes("5-star") || q.includes("5 star")) ||
    q.includes("best review") ||
    q.includes("worst review") ||
    q.includes("give me the best") ||
    q.includes("give me the worst") ||
    q.includes("dikhao") || // "show" in Hindi/Hinglish
    q.includes("dikha do") ||
    q.includes("dekhna h") || // "want to see" — "mujhe ... reviews dekhna h"
    q.includes("dekhna hai") ||
    q.includes("dekhna") ||
    q.includes("batao") || // "tell me"
    q.includes("nikalo") || // "pull up"
    q.includes("de do") // "give [me]"
  ) {
    return AnalyticalIntent.REVIEW_EXPLORATION;
  }

  // TOP_PROBLEM (high priority — analytical question)
  if (
    q.includes("biggest issue") ||
    q.includes("biggest problem") ||
    q.includes("main problem") ||
    q.includes("main issue") ||
    q.includes("most unhappy") ||
    q.includes("hurting this") ||
    q.includes("what's wrong") ||
    q.includes("what is wrong") ||
    q.includes("what's wrong with") ||
    q.includes("fix first") ||
    q.includes("top problem") ||
    q.includes("sabse badi") || // "biggest" in Hinglish (e.g. "sabse badi problem")
    q.includes("sabse bada") ||
    (q.includes("kya dikkat") ) || // "what's the issue" — "product me kya dikkat h"
    (q.includes("kya problem")) ||
    q.includes("scene hai") || q.includes("scene h") || q.includes("kya scene") // "what's the status/issue"
  ) {
    return AnalyticalIntent.TOP_PROBLEM;
  }

  // RECOMMENDATION (before STATS_QUERY) — loosened per spec item 2: a fixed
  // exact-phrase list ("how can we improve") missed real, grammatically-off
  // user phrasing like "how can improve this product" (no "we"). Now matched
  // with a pattern requiring "how" + (can|do|could|to) + optional filler +
  // improve|fix, OR "what should" + improve|fix|change, so minor word-order/
  // pronoun variance doesn't fall through to STATS_QUERY.
  if (
    /\bhow\s+(?:can|do|could|to)\b(?:\s+\w+){0,3}?\s*\b(?:improve|fix)\b/.test(q) ||
    /\bwhat\s+should\b(?:\s+\w+){0,4}?\s*\b(?:improve|fix|change)\b/.test(q) ||
    /\bwhat\s+changes\s+should\b/.test(q) ||
    q.includes("what to do") ||
    q.includes("what to fix")
  ) {
    return AnalyticalIntent.RECOMMENDATION;
  }

  // COMPLAINT_ANALYSIS
  if (
    q.includes("complain") ||
    q.includes("complaint") ||
    q.includes("problems customers") ||
    q.includes("customer problems") ||
    q.includes("customers mention") ||
    q.includes("what mention") ||
    q.includes("negative") ||
    q.includes("bad") ||
    q.includes("dikkat") || // "issue"/"trouble"
    q.includes("pareshan") || // "bothered"/"troubled" — "kis baat se pareshan"
    q.includes("kharaab") || // "bad"/"faulty"
    q.includes("kharab") ||
    q.includes("problem")
  ) {
    return AnalyticalIntent.COMPLAINT_ANALYSIS;
  }

  // POSITIVE_FEEDBACK
  if (
    q.includes("like") ||
    q.includes("love") ||
    q.includes("happy") ||
    q.includes("satisfied") ||
    q.includes("appreciate") ||
    q.includes("positive") ||
    q.includes("good about") ||
    q.includes("achhe") || // "good" in Hinglish
    q.includes("acche") ||
    q.includes("badhiya") // "great"/"nice"
  ) {
    return AnalyticalIntent.POSITIVE_FEEDBACK;
  }

  // EVIDENCE_RETRIEVAL
  if (q.includes("evidence") || q.includes("supporting review") || q.includes("show evidence")) {
    return AnalyticalIntent.EVIDENCE_RETRIEVAL;
  }

  // RATING_DECLINE
  if (
    q.includes("rating low") ||
    q.includes("rating decline") ||
    q.includes("why rating") ||
    q.includes("why low") ||
    q.includes("rating drop") ||
    q.includes("why is the rating")
  ) {
    return AnalyticalIntent.RATING_DECLINE;
  }

  // TIME_COMPARISON (requires temporal language)
  if (
    q.includes("change") ||
    q.includes("changed") ||
    q.includes("recently") ||
    q.includes("vs ") ||
    q.includes("versus") ||
    q.includes("compare") ||
    q.includes("compared to")
  ) {
    return AnalyticalIntent.TIME_COMPARISON;
  }

  // Default: generic statistics query
  return AnalyticalIntent.STATS_QUERY;
}

/**
 * Prior turn context used to resolve ambiguous, short, anaphoric follow-ups
 * ("show me", "show those", "why?", "latest 3") against the last real turn
 * instead of reclassifying them cold, in isolation.
 */
export interface PriorTurnContext {
  intent: AnalyticalIntent;
  /** The aspect/theme the previous ANALYSIS turn identified as root cause, if any. */
  aspect?: string;
  /** Review IDs actually shown/cited in the previous turn (retrieval results or evidence). */
  reviewIds?: string[];
}

export type ResolvedIntentKind = "RETRIEVAL" | "ANALYSIS" | "NEEDS_CLARIFICATION" | "EXPLAIN_PREVIOUS";

export interface ResolvedIntent {
  kind: ResolvedIntentKind;
  intent: AnalyticalIntent | null;
  /** True if this turn was resolved from prior context rather than classified fresh. */
  resolvedFromContext: boolean;
  /** Context carried over/used, when resolvedFromContext is true. */
  context?: PriorTurnContext;
  /** Present only when kind === "NEEDS_CLARIFICATION". */
  clarificationPrompt?: string;
}

const CLARIFICATION_PROMPT =
  "What would you like me to show — the latest reviews, supporting evidence, or the product analysis?";

/** Bare anaphoric follow-ups that never carry enough standalone meaning. */
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

function isShortOrAnaphoric(question: string): boolean {
  const q = question.toLowerCase().trim().replace(/[.,!]+$/g, "");
  if (ANAPHORIC_PATTERNS.some((p) => p.test(q))) return true;
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  return wordCount <= 3;
}

function isExplainPrevious(question: string): boolean {
  const q = question.toLowerCase().trim().replace(/[.,!]+$/g, "");
  return /^why\??$/.test(q) || /^why is that\??$/.test(q) || /^explain( more| in detail)?$/.test(q);
}

/**
 * Resolve intent for a message, taking prior-turn context into account for
 * short/ambiguous follow-ups. Falls back to plain detectIntent() classification
 * for anything that isn't judged ambiguous.
 */
export function resolveIntentWithContext(question: string, priorContext?: PriorTurnContext): ResolvedIntent {
  const rawIntent = detectIntent(question);
  const ambiguous = isShortOrAnaphoric(question);

  if (!ambiguous) {
    return {
      kind: isRetrievalIntent(rawIntent) ? "RETRIEVAL" : "ANALYSIS",
      intent: rawIntent,
      resolvedFromContext: false,
    };
  }

  // Ambiguous/short message: try to resolve using prior context.
  if (!priorContext) {
    return {
      kind: "NEEDS_CLARIFICATION",
      intent: null,
      resolvedFromContext: false,
      clarificationPrompt: CLARIFICATION_PROMPT,
    };
  }

  if (isExplainPrevious(question)) {
    return {
      kind: "EXPLAIN_PREVIOUS",
      intent: priorContext.intent,
      resolvedFromContext: true,
      context: priorContext,
    };
  }

  // "show me" / "show those" / bare number after context exists: resolve as
  // retrieval, reusing the prior aspect (if any) as an implicit filter hint.
  return {
    kind: isRetrievalIntent(priorContext.intent) || /show|latest|top|first|last/.test(question.toLowerCase())
      ? "RETRIEVAL"
      : "ANALYSIS",
    intent: priorContext.intent,
    resolvedFromContext: true,
    context: priorContext,
  };
}

/**
 * Phase 10 query-understanding correction, item 4 — RECOMMEND_IMPROVEMENTS
 * needs a real, distinct response, not the generic stats-leaning narrator
 * path with just a different describeIntent() string. Every real provider's
 * narrate() appends this extra instruction only when analyticalIntent is
 * RECOMMENDATION, so the model is explicitly told to lead `summary` with the
 * recommended action grounded in negative evidence — never with
 * reviewCount/averageRating statistics as the primary content.
 */
export function recommendationInstructionLine(intent: AnalyticalIntent | undefined): string {
  if (intent !== AnalyticalIntent.RECOMMENDATION) return "";
  return (
    " This is a recommendation request: `summary` MUST lead with the recommended action, " +
    "not with reviewCount/averageRating statistics — statistics may appear only as brief " +
    "supporting context, never as the primary content. Structure `summary` as two clauses: " +
    "(1) what customers actually said (the observed problem, grounded in evidenceReviewIds), " +
    "then (2) what to do about it (the recommended action) — clearly distinguishable, not " +
    "merged into one generic statement. Each entry in `recommendations` must state a concrete " +
    "action in `reason`, not a restatement of the problem."
  );
}

/**
 * Provide human-readable description of an intent for use in AI prompts.
 */
export function describeIntent(intent: AnalyticalIntent): string {
  switch (intent) {
    case AnalyticalIntent.TOP_PROBLEM:
      return "identifying the dominant customer problem from negative review themes";
    case AnalyticalIntent.COMPLAINT_ANALYSIS:
      return "listing and explaining customer complaint themes";
    case AnalyticalIntent.POSITIVE_FEEDBACK:
      return "highlighting what customers appreciate about this product";
    case AnalyticalIntent.RATING_DECLINE:
      return "analyzing why the product rating may be low or declining";
    case AnalyticalIntent.TIME_COMPARISON:
      return "comparing product performance across time periods";
    case AnalyticalIntent.REVIEW_EXPLORATION:
      return "finding and displaying specific reviews matching criteria";
    case AnalyticalIntent.EVIDENCE_RETRIEVAL:
      return "identifying and showing reviews that support a claim";
    case AnalyticalIntent.RECOMMENDATION:
      return "providing actionable improvements based on verified customer problems";
    case AnalyticalIntent.STATS_QUERY:
      return "explaining general product statistics and metrics";
    default:
      return "answering questions about this product";
  }
}
