import { describe, it, expect, beforeEach } from "vitest";
import { appSequelize } from "../../src/database/appStore/client.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import {
  advanceLastSeenSourceId,
  getLastSeenSourceId,
} from "../../src/modules/ingestion/watermarkRepo.js";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

describe("crash safety — transaction/checkpoint atomicity", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("PROOF (mandatory safety test #7 / crash scenario 2): watermark does NOT advance if the write transaction fails", async () => {
    const before = await getLastSeenSourceId("flipkart");

    await expect(
      appSequelize.transaction(async (t) => {
        await advanceLastSeenSourceId("flipkart", before + 999, t);
        throw new Error("simulated failure mid-transaction, before commit");
      }),
    ).rejects.toThrow("simulated failure");

    const after = await getLastSeenSourceId("flipkart");
    expect(after).toBe(before); // unchanged — the failed transaction rolled back entirely
  });

  it("PROOF (crash scenario: write commits, then process dies before returning): rerunning is safe and does not corrupt state", async () => {
    // Run Track A to completion once (this is the "commit" — indistinguishable
    // from a real successful batch commit).
    const first = await runTrackA("flipkart");
    const countAfterFirst = await NormalizedReview.count({ where: { platform: "flipkart" } });

    // Simulate the process being killed immediately after and restarted: just
    // call Track A again exactly as a fresh process invocation would.
    const second = await runTrackA("flipkart");
    const countAfterSecond = await NormalizedReview.count({ where: { platform: "flipkart" } });

    expect(second.rowsRead).toBe(0); // watermark correctly reflects the completed first run
    expect(countAfterSecond).toBe(countAfterFirst);
    expect(countAfterFirst).toBe(first.rowsInserted);
  });

  it("a batch insert failure never leaves a partially-advanced watermark", async () => {
    const before = await getLastSeenSourceId("flipkart");

    await expect(
      appSequelize.transaction(async (t) => {
        // Insert a row with a NULL required field to force a DB-level failure
        // partway through the "batch", after the watermark update statement
        // has already been issued in the same transaction.
        await advanceLastSeenSourceId("flipkart", before + 1, t);
        // Deliberately invalid — canonicalReviewId omitted to force a
        // DB-level NOT NULL violation; `as never` bypasses the (correct)
        // static type check so the runtime constraint is what actually fails.
        const invalidRow = {
          platform: "flipkart",
          sourceProductId: "X",
          sourceReviewId: "Y",
          sourceRowId: 1,
          identityConfidence: "derived",
          rating: 5,
          reviewDate: "2026-01-01",
          dateConfidence: "day",
          contentHash: "x".repeat(64),
          sourceUpdatedAt: new Date(),
          mapperVersion: 1,
        } as never;
        await NormalizedReview.create(
          invalidRow,
          { transaction: t },
        );
      }),
    ).rejects.toThrow();

    const after = await getLastSeenSourceId("flipkart");
    expect(after).toBe(before);
  });
});
