import { describe, it, expect } from "vitest";
import { ApiError } from "@google/genai";
import { classifyGeminiError } from "../../src/modules/ai/providers/geminiProvider.js";

/**
 * Phase 4.1 remediation items 2/6 — classifyGeminiError() tested against
 * REAL, previously-captured Gemini error payloads (not synthetic/guessed
 * shapes), so this is PROVEN BY EXECUTION against genuine API responses
 * without spending any new real Gemini call to re-verify:
 *   - the 429 payload is byte-for-byte what Step 11 of Phase 4.1 captured
 *     from a real, deliberately-triggered rate limit.
 *   - the 400/404 payloads are byte-for-byte what the Step 11 reconciliation
 *     investigation (remediation item 6) captured from two real, controlled,
 *     non-aggressive calls (invalid key, invalid model name).
 */
describe("classifyGeminiError (Phase 4.1 remediation items 2/6) — against real captured payloads", () => {
  it("real 429 payload (Step 11) — provider_rate_limit, retryable, retryDelay parsed as 11000ms", () => {
    const realMessage =
      '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\\nPlease retry in 11.127411081s.","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.Help","links":[{"description":"Learn more about Gemini API quotas","url":"https://ai.google.dev/gemini-api/docs/rate-limits"}]},{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaDimensions":{"location":"global","model":"gemini-3.6-flash"},"quotaValue":"20"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"11s"}]}}';
    const err = new ApiError({ message: realMessage, status: 429 });

    const result = classifyGeminiError(err);

    expect(result.category).toBe("provider_rate_limit");
    expect(result.retryable).toBe(true);
    expect(result.retryAfterMs).toBe(11000);
  });

  it("real 400 API_KEY_INVALID payload (Step 11 reconciliation) — provider_auth, NOT retryable, despite the HTTP status being 400 not 401/403", () => {
    const realMessage =
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}},{"@type":"type.googleapis.com/google.rpc.LocalizedMessage","locale":"en-US","message":"API key not valid. Please pass a valid API key."}]}}';
    const err = new ApiError({ message: realMessage, status: 400 });

    const result = classifyGeminiError(err);

    // The whole point of this test: a naive status-code-only classifier would
    // call this "provider_error" (since 400 isn't 401/403) — the real API
    // uses 400 for auth failures too, distinguishable only via the
    // ErrorInfo.reason code, which is exactly what classifyGeminiError checks.
    expect(result.category).toBe("provider_auth");
    expect(result.retryable).toBe(false);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("real 404 model-not-found payload (Step 11 reconciliation) — provider_error, NOT retryable", () => {
    const realMessage =
      '{"error":{"code":404,"message":"models/this-model-does-not-exist-12345 is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.","status":"NOT_FOUND"}}';
    const err = new ApiError({ message: realMessage, status: 404 });

    const result = classifyGeminiError(err);

    expect(result.category).toBe("provider_error");
    expect(result.retryable).toBe(false);
  });

  it("a plain non-ApiError with 'timeout' in the message — provider_timeout, retryable (heuristic — no real timeout observed to verify against)", () => {
    const result = classifyGeminiError(new Error("request timeout after 30000ms"));
    expect(result.category).toBe("provider_timeout");
    expect(result.retryable).toBe(true);
  });

  it("a plain non-ApiError, no 'timeout' — falls back to provider_error, retryable (safe default, preserves pre-remediation behavior)", () => {
    const result = classifyGeminiError(new Error("ECONNRESET"));
    expect(result.category).toBe("provider_error");
    expect(result.retryable).toBe(true);
  });
});
