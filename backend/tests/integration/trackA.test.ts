import { describe, it, expect, beforeEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import { IngestionWatermark } from "../../src/database/appStore/models/ingestionWatermark.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

describe("Track A — new-row detection", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("discovers and inserts all seeded Flipkart fixture rows", async () => {
    const result = await runTrackA("flipkart");
    expect(result.rowsRead).toBeGreaterThanOrEqual(3); // seeded fixture rows
    expect(result.rowsInserted).toBeGreaterThanOrEqual(3);
    expect(result.rowsRejected).toBe(0);

    const stored = await NormalizedReview.findAll({ where: { platform: "flipkart" } });
    expect(stored.length).toBe(result.rowsInserted);
  });

  it("discovers and inserts all seeded Myntra fixture rows", async () => {
    const result = await runTrackA("myntra");
    expect(result.rowsRead).toBeGreaterThanOrEqual(3);
    expect(result.rowsInserted).toBeGreaterThanOrEqual(3);

    const stored = await NormalizedReview.findAll({ where: { platform: "myntra" } });
    expect(stored.length).toBe(result.rowsInserted);
  });

  it("advances the watermark to the max id seen", async () => {
    const result = await runTrackA("flipkart");
    const watermark = await IngestionWatermark.findByPk("flipkart");
    expect(Number(watermark?.lastSeenSourceId)).toBe(result.finalLastSeenSourceId);
  });

  it("PROOF: rerunning does not duplicate data (mandatory safety test #6)", async () => {
    const first = await runTrackA("flipkart");
    const countAfterFirst = await NormalizedReview.count({ where: { platform: "flipkart" } });

    const second = await runTrackA("flipkart");
    const countAfterSecond = await NormalizedReview.count({ where: { platform: "flipkart" } });

    expect(second.rowsRead).toBe(0); // watermark already past all seeded rows
    expect(countAfterSecond).toBe(countAfterFirst);
    expect(countAfterFirst).toBe(first.rowsInserted);
  });

  it("stores the correct canonical identity and content hash shape", async () => {
    await runTrackA("flipkart");
    const row = await NormalizedReview.findOne({ where: { platform: "flipkart" } });
    expect(row).not.toBeNull();
    expect(row!.canonicalReviewId).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.identityConfidence).toBe("derived");
  });

  it("marks Myntra reviews with native identity confidence", async () => {
    await runTrackA("myntra");
    const row = await NormalizedReview.findOne({ where: { platform: "myntra" } });
    expect(row!.identityConfidence).toBe("native");
  });
});
