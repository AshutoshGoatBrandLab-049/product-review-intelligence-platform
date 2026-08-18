import type { AiAnalysisInput, ReviewWithText } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";
import type { AnalyticalIntent } from "../intentDetection.js";
import type { QueryResolutionInput } from "../queryUnderstanding.js";
import type { PlannerInput } from "../semanticPlanner.js";

/**
 * Phase 4 §2 — provider abstraction. The pipeline (pipeline.ts) and the
 * narrator (narrator.ts) depend only on this interface, never on a specific
 * vendor SDK — swapping providers, or running entirely on the mock in
 * tests, never touches business logic.
 */
export interface AiProvider {
  readonly name: string;
  readonly modelVersion: string;
  /** Returns raw, unvalidated output — the caller runs it through validateAiOutput(). */
  analyzeReview(input: AiAnalysisInput): Promise<unknown>;
  /** Returns raw, unvalidated output — the caller runs it through validateNarratorOutput().
   * Phase 10 Step 3: userQuestion and analyticalIntent are optional but recommended
   * for intent-aware AI reasoning. Providers should use them to contextualize responses.
   */
  narrate(
    evidencePackage: ProductEvidencePackage,
    userQuestion?: string,
    analyticalIntent?: AnalyticalIntent,
  ): Promise<unknown>;
  /** Phase 10 Step 3: Analyze a batch of reviews for semantic aspects.
   * Returns array of {canonicalReviewId, observations: [{aspect, sentiment, textSnippet, confidence}]}
   */
  analyzeReviewBatch?(reviews: ReviewWithText[], prompt: string): Promise<unknown>;
  /**
   * Phase 10 semantic-query-understanding — structured/function-calling
   * query resolution. Given the user's raw question plus prior-turn and
   * product context, returns raw, unvalidated output; the caller
   * (queryUnderstanding.ts's resolveQuerySemantic()) runs it through
   * ResolvedQueryLlmOutputSchema before trusting any field. The model
   * chooses WHICH of a closed action enum a question belongs to and extracts
   * structural parameters only (a timeframe DESCRIPTOR, not a computed date;
   * sentiment; quantity; aspect) — it never computes a date, a review ID, or
   * a count.
   *
   * Optional (like analyzeReviewBatch above) so existing ad-hoc AiProvider
   * test doubles that only exercise analyzeReview()/narrate() keep
   * compiling unchanged — queryUnderstanding.ts's resolveQuerySemantic()
   * treats an absent implementation exactly like a provider failure and
   * falls back to the deterministic resolver.
   */
  resolveQuery?(input: QueryResolutionInput): Promise<unknown>;

  /**
   * Phase 10 Step 1 (PHASE B) — Semantic operation planning. Given a user's
   * natural-language question, returns a structured OperationPlan (or
   * cannotPlan response) using LLM semantic understanding.
   *
   * The model chooses which operations to sequence, with what parameters,
   * and in what dependency order. It NEVER generates SQL, code, or arbitrary
   * functions — only selects from the Phase A operation registry.
   *
   * Returns raw, unvalidated output (OperationPlanLlmOutput); the caller
   * (semanticPlanner.ts's planOperations()) runs it through schema validation
   * and PlanValidator before trusting any field.
   *
   * Optional (like resolveQuery and analyzeReviewBatch) so existing test
   * doubles keep compiling unchanged — semanticPlanner.ts treats an absent
   * implementation as a provider failure and returns a rejection.
   */
  planOperations?(input: PlannerInput): Promise<unknown>;
}

/**
 * Phase 4.1 remediation item 2/3 — deterministic failure classification, set
 * by the provider that actually knows the HTTP status/error shape (never
 * guessed downstream from a message string). "provider_error" is the
 * catch-all for a real provider failure that doesn't fit a more specific
 * bucket; "unknown" is reserved for non-AiProviderError failures.
 */
export type AiFailureCategory =
  | "provider_rate_limit"
  | "provider_timeout"
  | "provider_auth"
  | "provider_unavailable"
  | "provider_error"
  | "validation_error"
  | "persistence_error"
  | "unknown";

export interface AiProviderErrorOptions {
  /** Whether retrying this exact failure could plausibly succeed. Defaults
   * to true — preserves every existing call site's behavior unchanged. */
  retryable?: boolean;
  /** Provider-suggested wait before retrying, in ms, when the provider's
   * error response states one (e.g. Gemini's RetryInfo.retryDelay). */
  retryAfterMs?: number;
  category?: AiFailureCategory;
}

export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly category: AiFailureCategory;

  constructor(providerName: string, cause: string, options?: AiProviderErrorOptions) {
    super(`AI provider "${providerName}" failed: ${cause}`);
    this.name = "AiProviderError";
    this.retryable = options?.retryable ?? true;
    this.retryAfterMs = options?.retryAfterMs;
    this.category = options?.category ?? "provider_error";
  }
}
