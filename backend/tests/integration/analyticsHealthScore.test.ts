import { describe, it, expect, beforeEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { computeHealthScore, HEALTH_SCORE_WEIGHTS_V0 } from "../../src/modules/analytics/healthScore.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const WINDOW = resolveNamedWindow("30d");

describe("health score engine (Phase 3 §12, approved: totalScore stays null in Phase 3)", () => {
  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await rebuildAnalytics();
  });

  it("computes ratingScore and trendScore, but never fabricates totalScore", async () => {
    const score = await computeHealthScore("flipkart", "PID001", WINDOW);
    expect(score.ratingScore).toBeGreaterThanOrEqual(0);
    expect(score.ratingScore).toBeLessThanOrEqual(100);
    expect(score.trendScore).toBeGreaterThanOrEqual(0);
    expect(score.trendScore).toBeLessThanOrEqual(100);
    expect(score.sentimentScore).toBeNull();
    expect(score.complaintScore).toBeNull();
    expect(score.severityScore).toBeNull();
    expect(score.totalScore).toBeNull(); // approved: never renormalize a partial score
  });

  it("carries the approved v0 weights, labeled as a hypothesis", () => {
    expect(HEALTH_SCORE_WEIGHTS_V0).toEqual({ rating: 0.30, sentiment: 0.25, complaint: 0.20, severity: 0.15, trend: 0.10 });
  });

  it("version is explicitly labeled as a hypothesis, not an approved formula", async () => {
    const score = await computeHealthScore("flipkart", "PID001", WINDOW);
    expect(score.version).toBe("health-v0-hypothesis");
  });
});
