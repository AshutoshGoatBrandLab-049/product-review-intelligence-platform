import type { AiAnalysisInput } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";

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
  /** Returns raw, unvalidated output — the caller runs it through validateNarratorOutput(). */
  narrate(evidencePackage: ProductEvidencePackage): Promise<unknown>;
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
