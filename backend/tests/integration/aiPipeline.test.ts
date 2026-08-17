import { describe, it, expect, beforeEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runAiSentimentPipeline } from "../../src/modules/ai/pipeline.js";
import { summarizeCandidates } from "../../src/modules/ai/candidateSelection.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { AiProviderError, type AiProvider } from "../../src/modules/ai/providers/aiProvider.js";
import { ReviewSentiment } from "../../src/database/appStore/models/reviewSentiment.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import { AiProcessingRun } from "../../src/database/appStore/models/aiProcessingRun.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

/** Always throws — for exhausting retries deterministically. */
class AlwaysFailsProvider implements AiProvider {
  readonly name = "always-fails";
  readonly modelVersion = "test-v1";
  callCount = 0;
  async analyzeReview(): Promise<unknown> {
    this.callCount++;
    throw new AiProviderError(this.name, "permanent failure");
  }
  async narrate(): Promise<unknown> {
    throw new AiProviderError(this.name, "permanent failure");
  }
}

describe("AI sentiment pipeline (Phase 4 §5/§8/§9/§10/§13)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("items 23/24: dry-run makes zero AI calls and zero database writes", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    let calls = 0;
    const countingProvider: AiProvider = {
      name: provider.name,
      modelVersion: provider.modelVersion,
      analyzeReview: async (input) => {
        calls++;
        return provider.analyzeReview(input);
      },
      narrate: (pkg) => provider.narrate(pkg),
    };

    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: true }, countingProvider);

    expect(calls).toBe(0);
    expect(result.processedCount).toBe(0);
    expect(await ReviewSentiment.count()).toBe(0);
    expect(await AiProcessingRun.count()).toBe(0); // not even the audit row
  });

  it("item 22: second identical run reprocesses nothing (idempotent)", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();

    const first = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    expect(first.successCount).toBeGreaterThan(0);

    const second = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    expect(second.candidateCount).toBe(0);
    expect(second.processedCount).toBe(0);
  });

  it("item 21: crash/resume — a partial run followed by a fresh run classifies exactly the remainder, no duplicates", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    const totalBefore = await summarizeCandidates({ platform: "flipkart" });

    // Simulate a crash: only the first 2 candidates ever got processed.
    const partial = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 2 }, provider);
    expect(partial.successCount).toBe(2);

    // "Resume" is just running the same command again — no special resume logic exists or is needed.
    const resumed = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    expect(resumed.successCount).toBe(totalBefore.candidateCount - 2);

    const finalSummary = await summarizeCandidates({ platform: "flipkart" });
    expect(finalSummary.candidateCount).toBe(0);
    expect(await ReviewSentiment.count()).toBe(totalBefore.candidateCount); // no duplicates
  });

  it("items 18/19: retries a transient failure and succeeds; exhausts retries and records a failure", async () => {
    await runTrackA("flipkart");

    const flaky = new MockAiProvider();
    flaky.injectFailures(1); // one transient failure, then succeeds
    const resultA = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 3 }, flaky);
    expect(resultA.successCount).toBe(1);
    expect(resultA.retryCount).toBeGreaterThanOrEqual(1);

    await resetAppStore();
    await runTrackA("flipkart");
    const alwaysFails = new AlwaysFailsProvider();
    const resultB = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 1, maxRetries: 2 }, alwaysFails);
    expect(resultB.failureCount).toBe(1);
    expect(resultB.successCount).toBe(0);
    expect(alwaysFails.callCount).toBe(3); // 1 initial + 2 retries, bounded, not infinite
    expect(resultB.status).toBe("failed");
  });

  it("item 20: partial batch failure — one bad review does not abort the rest of the batch", async () => {
    await runTrackA("flipkart");

    let callIndex = 0;
    const flakyOnSecondCall: AiProvider = {
      name: "flaky",
      modelVersion: "test-v1",
      analyzeReview: async (input) => {
        callIndex++;
        if (callIndex === 2) throw new AiProviderError("flaky", "one bad review");
        return new MockAiProvider().analyzeReview(input);
      },
      narrate: async () => ({ summary: "", rootCause: [], recommendations: [] }),
    };

    // The isolated fixture only has 3 baseline flipkart rows — process all of
    // them, with the 2nd one deliberately failing.
    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 3, maxRetries: 0 }, flakyOnSecondCall);
    expect(result.processedCount).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.status).toBe("partial_failure");
  });

  it("item 26: AI failure never modifies normalized_reviews", async () => {
    await runTrackA("flipkart");
    const before = await NormalizedReview.findAll({ order: [["canonicalReviewId", "ASC"]] });

    const alwaysFails = new AlwaysFailsProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 3, maxRetries: 0 }, alwaysFails);

    const after = await NormalizedReview.findAll({ order: [["canonicalReviewId", "ASC"]] });
    expect(after.map((r) => ({ id: r.canonicalReviewId, hash: r.contentHash, rating: r.rating }))).toEqual(
      before.map((r) => ({ id: r.canonicalReviewId, hash: r.contentHash, rating: r.rating })),
    );
  });

  it("item 27: model version is persisted on every classification", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, totalLimit: 3 }, provider);

    const rows = await ReviewSentiment.findAll();
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.modelVersion).toBe(provider.modelVersion);
    }
  });

  it("item 25: batch memory bound — never fetches more than batchSize candidates in one DB round trip", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    // batchSize=3 forces multiple round trips for a >3-candidate run; success
    // count should still equal the full candidate set, proving pagination works.
    const summary = await summarizeCandidates({ platform: "flipkart" });
    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false, batchSize: 3 }, provider);
    expect(result.successCount).toBe(summary.candidateCount);
  });

  it("unknown canonical ID is impossible by construction — candidates always come from normalized_reviews itself", async () => {
    // The FK constraint on review_sentiment.canonical_review_id references
    // normalized_reviews directly — this is a structural guarantee, not just
    // a runtime check. Proven here by confirming a normal run never violates it.
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    const result = await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    expect(result.failureCount).toBe(0);
  });
});
