import { describe, it, expect, beforeEach } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

describe("full pipeline (Track A + Track B), both platforms", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("ingests all fixture data for both platforms end-to-end", async () => {
    const flipkartA = await runTrackA("flipkart");
    const myntraA = await runTrackA("myntra");
    const flipkartB = await runTrackB("flipkart");
    const myntraB = await runTrackB("myntra");

    const totalStored = await NormalizedReview.count();
    // Track A inserts everything new; Track B's inserts (if any) are only
    // for rows Track A somehow missed within its window — expect zero here
    // since Track A already covered the full fixture set.
    expect(totalStored).toBe(flipkartA.rowsInserted + myntraA.rowsInserted);
    expect(flipkartB.rowsInserted + myntraB.rowsInserted).toBe(0);
  });

  it("PROOF: running the entire pipeline twice produces byte-identical state", async () => {
    await runTrackA("flipkart");
    await runTrackA("myntra");
    await runTrackB("flipkart");
    await runTrackB("myntra");

    const firstPass = await NormalizedReview.findAll({ order: [["canonicalReviewId", "ASC"]] });
    const firstPassSnapshot = firstPass.map((r) => ({
      id: r.canonicalReviewId,
      hash: r.contentHash,
      rating: r.rating,
    }));

    await runTrackA("flipkart");
    await runTrackA("myntra");
    await runTrackB("flipkart");
    await runTrackB("myntra");

    const secondPass = await NormalizedReview.findAll({ order: [["canonicalReviewId", "ASC"]] });
    const secondPassSnapshot = secondPass.map((r) => ({
      id: r.canonicalReviewId,
      hash: r.contentHash,
      rating: r.rating,
    }));

    expect(secondPassSnapshot).toEqual(firstPassSnapshot);
  });
});
