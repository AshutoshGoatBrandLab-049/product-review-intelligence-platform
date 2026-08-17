import { describe, it, expect, beforeEach } from "vitest";
import { acquireLock, releaseLock, LockHeldError, LockAcquisitionError } from "../../src/modules/ingestion/watermarkRepo.js";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import { IngestionWatermark } from "../../src/database/appStore/models/ingestionWatermark.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

/**
 * Phase 2.1 §1E — real correctness test, replacing Phase 2 §18's
 * characterization-only version now that locking is advisory-lock based
 * (advisoryLock.ts). Two workers race for real via Promise.allSettled; a
 * shared in-memory flag directly detects true overlap of the protected
 * section (stronger than inferring overlap from timestamps after the fact).
 */
let currentlyRunning: string | null = null;
let concurrentExecutionDetected = false;

type WorkerOutcome = "ran" | "blocked" | "crashed";

async function worker(platform: "flipkart" | "myntra", label: string): Promise<WorkerOutcome> {
  try {
    await acquireLock(platform);
  } catch (err) {
    if (err instanceof LockHeldError) return "blocked";
    return "crashed"; // includes LockAcquisitionError or anything unexpected
  }

  try {
    if (currentlyRunning !== null) concurrentExecutionDetected = true;
    currentlyRunning = label;

    await runTrackA(platform);

    if (currentlyRunning !== label) concurrentExecutionDetected = true;
    currentlyRunning = null;
    return "ran";
  } finally {
    await releaseLock(platform);
  }
}

describe("concurrency — two workers racing for the same platform lock (Phase 2.1 §1E, advisory-lock based)", () => {
  beforeEach(async () => {
    await resetAppStore();
    currentlyRunning = null;
    concurrentExecutionDetected = false;
  });

  it("20 concurrent race iterations: never concurrent execution, never an unhandled crash, never duplicate rows, never a corrupted watermark", async () => {
    const ITERATIONS = 20;
    let ranCount = 0;
    let blockedCount = 0;
    let crashedCount = 0;
    let duplicateRowsDetected = 0;
    let corruptedWatermarkDetected = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      await resetAppStore();
      currentlyRunning = null;

      const [a, b] = await Promise.allSettled([worker("flipkart", "A"), worker("flipkart", "B")]);
      const outcomes = [a, b].map((r) => (r.status === "fulfilled" ? r.value : "crashed"));

      for (const o of outcomes) {
        if (o === "ran") ranCount++;
        else if (o === "blocked") blockedCount++;
        else crashedCount++;
      }

      // Exactly one of the two must have run — the other must be cleanly
      // blocked, never a silent crash and never both running.
      expect(outcomes.filter((o) => o === "ran").length).toBe(1);
      expect(outcomes.filter((o) => o === "blocked").length).toBe(1);
      expect(outcomes).not.toContain("crashed");

      const rows = await NormalizedReview.findAll({ where: { platform: "flipkart" } });
      const canonicalIds = rows.map((r) => r.canonicalReviewId);
      if (new Set(canonicalIds).size !== canonicalIds.length) duplicateRowsDetected++;

      const watermark = await IngestionWatermark.findByPk("flipkart");
      if (watermark && watermark.status !== "idle") corruptedWatermarkDetected++;

      await releaseLock("flipkart").catch(() => undefined);
    }

    console.log(
      `Concurrency race report — iterations: ${ITERATIONS}, ran: ${ranCount}, blocked: ${blockedCount}, ` +
        `crashed: ${crashedCount}, concurrentExecutionDetected: ${concurrentExecutionDetected}, ` +
        `duplicateRowsDetected: ${duplicateRowsDetected}, corruptedWatermarkDetected: ${corruptedWatermarkDetected}`,
    );

    expect(ranCount).toBe(ITERATIONS);
    expect(blockedCount).toBe(ITERATIONS);
    expect(crashedCount).toBe(0);
    expect(concurrentExecutionDetected).toBe(false);
    expect(duplicateRowsDetected).toBe(0);
    expect(corruptedWatermarkDetected).toBe(0);
  });

  it("locks for different platforms never block each other, even when raced concurrently", async () => {
    const [a, b] = await Promise.allSettled([worker("flipkart", "A"), worker("myntra", "B")]);
    const outcomes = [a, b].map((r) => (r.status === "fulfilled" ? r.value : "crashed"));
    expect(outcomes).toEqual(["ran", "ran"]);
  });

  it("LockAcquisitionError and LockHeldError are distinguishable error types", () => {
    expect(new LockHeldError("flipkart").name).toBe("LockHeldError");
    expect(new LockAcquisitionError("flipkart", "test").code).toBe("LOCK_ACQUISITION_FAILED");
  });
});
