import { describe, it, expect, beforeEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

/**
 * Phase 2.1 §4/§5 — proves the observability fields requested (jobId,
 * explicit status, durationMs) are actually present on the result objects
 * that get logged, not just assumed. Log line *shape* is exercised
 * implicitly by every other integration test already logging through
 * logger.ts; this test targets the specific new fields.
 */
describe("observability (Phase 2.1 §4/§5)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("runTrackA generates a jobId when none is passed, and reports status/durationMs", async () => {
    const result = await runTrackA("flipkart");
    expect(typeof result.jobId).toBe("string");
    expect(result.jobId.length).toBeGreaterThan(0);
    expect(result.status).toBe("success");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runTrackA/runTrackB echo back an explicitly-provided jobId, correlating both tracks to one run", async () => {
    const jobId = "test-job-12345";
    const a = await runTrackA("flipkart", jobId);
    const b = await runTrackB("flipkart", jobId);
    expect(a.jobId).toBe(jobId);
    expect(b.jobId).toBe(jobId);
  });

  it("runTrackB reports status/durationMs on a clean run", async () => {
    const result = await runTrackB("flipkart");
    expect(result.status).toBe("success");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
