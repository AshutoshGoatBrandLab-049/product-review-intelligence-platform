import { describe, it, expect, beforeEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { runAiSentimentPipeline } from "../../src/modules/ai/pipeline.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { computeHealthScore } from "../../src/modules/analytics/healthScore.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const WINDOW = resolveNamedWindow("30d");

describe("health score — Phase 4 wiring of sentiment/complaint scores (Step 20)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("sentimentScore/complaintScore are null before any AI classification exists", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const score = await computeHealthScore("flipkart", "PID001", WINDOW);
    expect(score.sentimentScore).toBeNull();
    expect(score.complaintScore).toBeNull();
    expect(score.totalScore).toBeNull();
  });

  it("sentimentScore becomes available once validated sentiment exists — never renormalized into a fake total", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);

    const score = await computeHealthScore("flipkart", "PID001", WINDOW);
    expect(score.sentimentScore).not.toBeNull();
    expect(score.sentimentScore).toBeGreaterThanOrEqual(0);
    expect(score.sentimentScore).toBeLessThanOrEqual(100);
    // severityScore has no approved formula (Phase 4 §19) — totalScore must
    // still be null even though rating/trend/sentiment are all available.
    expect(score.severityScore).toBeNull();
    expect(score.totalScore).toBeNull();
  });

  it("approved weights are never silently changed", async () => {
    const score = await computeHealthScore("flipkart", "PID001", WINDOW);
    expect(score.weights).toEqual({ rating: 0.30, sentiment: 0.25, complaint: 0.20, severity: 0.15, trend: 0.10 });
    expect(score.version).toBe("health-v0-hypothesis");
  });
});
