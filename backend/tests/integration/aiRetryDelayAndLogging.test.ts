import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runAiSentimentPipeline } from "../../src/modules/ai/pipeline.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { AiProviderError, type AiProvider } from "../../src/modules/ai/providers/aiProvider.js";
import { ReviewSentiment } from "../../src/database/appStore/models/reviewSentiment.js";
import { logger } from "../../src/shared/logger.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

/**
 * Phase 4.1 remediation items 2/3 — retry-delay-honoring backoff and
 * structured failure logging (platform + failureCategory). Uses controlled,
 * mocked provider errors throughout, never a real Gemini call — exactly as
 * instructed ("Do not make aggressive real Gemini calls just to force a 429.
 * Use a controlled mocked/provider error for timing/backoff tests").
 */
describe("AI retry-delay backoff (Phase 4.1 remediation item 2)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("1: retryable error WITH retryAfterMs — retry waits at least the requested delay", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const attemptTimestamps: number[] = [];
    const provider: AiProvider = {
      name: "delay-test",
      modelVersion: "test-v1",
      analyzeReview: async (input) => {
        attemptTimestamps.push(Date.now());
        calls++;
        if (calls === 1) {
          throw new AiProviderError("delay-test", "rate limited", { retryable: true, retryAfterMs: 300, category: "provider_rate_limit" });
        }
        return new MockAiProvider().analyzeReview(input);
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 2 }, provider);

    expect(calls).toBe(2);
    expect(result.successCount).toBe(1);
    const gapMs = attemptTimestamps[1]! - attemptTimestamps[0]!;
    expect(gapMs).toBeGreaterThanOrEqual(300);
  });

  it("2: retryable error WITHOUT retryAfterMs — falls back to existing minTimeout backoff, no pathological wait", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const attemptTimestamps: number[] = [];
    const provider: AiProvider = {
      name: "no-delay-test",
      modelVersion: "test-v1",
      analyzeReview: async (input) => {
        attemptTimestamps.push(Date.now());
        calls++;
        if (calls === 1) {
          throw new AiProviderError("no-delay-test", "transient failure"); // retryable defaults true, no retryAfterMs
        }
        return new MockAiProvider().analyzeReview(input);
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 2 }, provider);

    expect(calls).toBe(2);
    expect(result.successCount).toBe(1);
    const gapMs = attemptTimestamps[1]! - attemptTimestamps[0]!;
    expect(gapMs).toBeLessThan(300); // did not take the 300ms-plus explicit-delay path
  });

  it("3: non-retryable error — no unnecessary retries, fails after exactly 1 attempt", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const provider: AiProvider = {
      name: "auth-fail-test",
      modelVersion: "test-v1",
      analyzeReview: async () => {
        calls++;
        throw new AiProviderError("auth-fail-test", "invalid API key", { retryable: false, category: "provider_auth" });
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 5 }, provider);

    expect(calls).toBe(1); // never retried, despite maxRetries: 5
    expect(result.failureCount).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.perReviewOutcomes[0]!.failureCategory).toBe("provider_auth");
  });

  it("4: retry exhaustion (retryable, always fails) still behaves correctly — 1 initial + maxRetries attempts, then fails", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const provider: AiProvider = {
      name: "always-fails-retryable",
      modelVersion: "test-v1",
      analyzeReview: async () => {
        calls++;
        throw new AiProviderError("always-fails-retryable", "transient", { retryable: true, category: "provider_unavailable" });
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 2 }, provider);

    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(result.failureCount).toBe(1);
    expect(result.status).toBe("failed");
  });

  it("5: no partial DB writes when a review fails then recovers via delayed retry — exactly 1 row, not 0 or 2", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const provider: AiProvider = {
      name: "recovers-after-delay",
      modelVersion: "test-v1",
      analyzeReview: async (input) => {
        calls++;
        if (calls === 1) throw new AiProviderError("recovers-after-delay", "rate limited", { retryable: true, retryAfterMs: 50, category: "provider_rate_limit" });
        return new MockAiProvider().analyzeReview(input);
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 2 }, provider);

    expect(await ReviewSentiment.count()).toBe(1);
  });

  it("6: retry counters are clearly defined — retries = number of failed attempts (not 'retries beyond first'), consistent with existing semantics", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const provider: AiProvider = {
      name: "two-failures-then-success",
      modelVersion: "test-v1",
      analyzeReview: async (input) => {
        calls++;
        if (calls <= 2) throw new AiProviderError("two-failures-then-success", "transient", { retryable: true, category: "provider_unavailable" });
        return new MockAiProvider().analyzeReview(input);
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 3 }, provider);

    expect(calls).toBe(3);
    expect(result.retryCount).toBe(2);
    expect(result.perReviewOutcomes[0]!.retries).toBe(2);
    expect(result.perReviewOutcomes[0]!.outcome).toBe("success");
  });
});

describe("AI structured failure logging (Phase 4.1 remediation item 3)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn");
    errorSpy = vi.spyOn(logger, "error");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("rate-limit error produces failureCategory: provider_rate_limit, with platform present", async () => {
    await runTrackA("flipkart");
    const provider: AiProvider = {
      name: "rate-limit-log-test",
      modelVersion: "test-v1",
      analyzeReview: async () => {
        throw new AiProviderError("rate-limit-log-test", "rate limited", { retryable: false, category: "provider_rate_limit" });
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 0 }, provider);

    const errorCall = errorSpy.mock.calls.find(([obj]) => (obj as Record<string, unknown>).failureCategory === "provider_rate_limit");
    expect(errorCall).toBeDefined();
    expect((errorCall![0] as Record<string, unknown>).platform).toBe("flipkart");
  });

  it("validation error produces failureCategory: validation_error, with platform present", async () => {
    await runTrackA("flipkart");
    const provider: AiProvider = {
      name: "bad-output-test",
      modelVersion: "test-v1",
      analyzeReview: async () => ({ sentiment: { label: "not-a-real-label", confidence: 2 }, themes: [] }), // fails schema validation
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 0 }, provider);

    const errorCall = errorSpy.mock.calls.find(([obj]) => (obj as Record<string, unknown>).failureCategory === "validation_error");
    expect(errorCall).toBeDefined();
    expect((errorCall![0] as Record<string, unknown>).platform).toBe("flipkart");
  });

  it("generic provider failure defaults to failureCategory: provider_error", async () => {
    await runTrackA("flipkart");
    const provider: AiProvider = {
      name: "generic-fail-test",
      modelVersion: "test-v1",
      analyzeReview: async () => {
        throw new AiProviderError("generic-fail-test", "something went wrong"); // no category specified -> defaults to provider_error
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 0 }, provider);

    const errorCall = errorSpy.mock.calls.find(([obj]) => (obj as Record<string, unknown>).failureCategory === "provider_error");
    expect(errorCall).toBeDefined();
  });

  it("retry-warning logs also carry platform + failureCategory", async () => {
    await runTrackA("flipkart");
    let calls = 0;
    const provider: AiProvider = {
      name: "warn-log-test",
      modelVersion: "test-v1",
      analyzeReview: async (input) => {
        calls++;
        if (calls === 1) throw new AiProviderError("warn-log-test", "transient", { retryable: true, category: "provider_unavailable" });
        return new MockAiProvider().analyzeReview(input);
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 2 }, provider);

    const warnCall = warnSpy.mock.calls.find(([obj]) => (obj as Record<string, unknown>).failureCategory === "provider_unavailable");
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as Record<string, unknown>).platform).toBe("flipkart");
  });

  it("no forbidden PII/secret keys ever appear in these new log fields (guard would throw otherwise)", async () => {
    await runTrackA("flipkart");
    const provider: AiProvider = {
      name: "pii-safety-test",
      modelVersion: "test-v1",
      analyzeReview: async () => {
        throw new AiProviderError("pii-safety-test", "failure", { retryable: false, category: "provider_error" });
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    // If a forbidden key (reviewText, title, author, etc.) were ever logged,
    // the logger's own PII guard (tests/security/piiLogging.test.ts) throws
    // in non-production — so a clean run here is itself the proof.
    await expect(
      runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 0 }, provider),
    ).resolves.toBeDefined();
  });
});
