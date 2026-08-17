import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { recordReject } from "../../src/modules/ingestion/shared/rejectRecorder.js";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { IngestionReject } from "../../src/database/appStore/models/ingestionReject.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres", // superuser needed to mutate the fixture table for this test
  password: "1234",
});

/**
 * Phase 2.1 §2D — proves recordReject's idempotent upsert behavior, both as
 * a direct unit of the rejectRecorder module (Tests 1-4, 6) and through the
 * real Track B pipeline against the isolated source fixture (Test 5, which
 * needs the actual validate -> reject/pass branch, not just the recorder in
 * isolation).
 */
describe("reject deduplication (Phase 2.1 §2)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  afterAll(async () => {
    await fixturePool.end();
  });

  it("Test 1: an invalid row encountered once produces exactly one reject row", async () => {
    await recordReject({
      platform: "flipkart",
      sourceRowId: 999901,
      sourceProductId: "P1",
      sourceReviewId: "R1",
      reason: "invalid_rating",
      failedFields: { rating: 0, platform: "flipkart" },
    });

    const rows = await IngestionReject.findAll({ where: { sourceRowId: 999901 } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.occurrenceCount).toBe(1);
  });

  it("Test 2: the same invalid row encountered 10 times still produces exactly one logical reject", async () => {
    for (let i = 0; i < 10; i++) {
      await recordReject({
        platform: "flipkart",
        sourceRowId: 999902,
        sourceProductId: "P1",
        sourceReviewId: "R2",
        reason: "invalid_rating",
        failedFields: { rating: 0, platform: "flipkart" },
      });
    }

    const rows = await IngestionReject.findAll({ where: { sourceRowId: 999902 } });
    expect(rows.length).toBe(1);
  });

  it("Test 3: repeated observation of the same (platform, source_row_id, reason) increments occurrence_count and advances last_seen_at", async () => {
    await recordReject({
      platform: "flipkart",
      sourceRowId: 999903,
      sourceProductId: "P1",
      sourceReviewId: "R3",
      reason: "invalid_rating",
      failedFields: { rating: 0, platform: "flipkart" },
    });
    const first = await IngestionReject.findOne({ where: { sourceRowId: 999903 } });
    const firstSeenAt = first!.lastSeenAt.getTime();

    await new Promise((r) => setTimeout(r, 20));

    for (let i = 0; i < 4; i++) {
      await recordReject({
        platform: "flipkart",
        sourceRowId: 999903,
        sourceProductId: "P1",
        sourceReviewId: "R3",
        reason: "invalid_rating",
        failedFields: { rating: 0, platform: "flipkart" },
      });
    }

    const after = await IngestionReject.findOne({ where: { sourceRowId: 999903 } });
    expect(after!.occurrenceCount).toBe(5); // 1 initial + 4 repeats
    expect(after!.lastSeenAt.getTime()).toBeGreaterThan(firstSeenAt);
    expect(after!.firstSeenAt.getTime()).toBe(first!.firstSeenAt.getTime()); // unchanged
  });

  it("Test 4: the same source row failing for a DIFFERENT reason gets its own independently-tracked row", async () => {
    await recordReject({
      platform: "flipkart",
      sourceRowId: 999904,
      sourceProductId: "P1",
      sourceReviewId: "R4",
      reason: "invalid_rating",
      failedFields: { rating: 0, platform: "flipkart" },
    });
    await recordReject({
      platform: "flipkart",
      sourceRowId: 999904,
      sourceProductId: "",
      sourceReviewId: "R4",
      reason: "missing_product_id",
      failedFields: { platform: "flipkart", sourceProductId: "" },
    });

    const rows = await IngestionReject.findAll({ where: { sourceRowId: 999904 }, order: [["reason", "ASC"]] });
    // Two distinct rows, one per reason — not merged, not overwritten.
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.reason).sort()).toEqual(["invalid_rating", "missing_product_id"]);
    expect(rows.every((r) => r.occurrenceCount === 1)).toBe(true);
  });

  it("Test 6: two concurrent recorders for the same invalid row never produce a duplicate logical rejection", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        recordReject({
          platform: "flipkart",
          sourceRowId: 999906,
          sourceProductId: "P1",
          sourceReviewId: "R6",
          reason: "invalid_rating",
          failedFields: { rating: 0, platform: "flipkart" },
        }),
      ),
    );

    const rows = await IngestionReject.findAll({ where: { sourceRowId: 999906 } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.occurrenceCount).toBe(8); // the atomic DB-level increment survived the race
  });

  it("Test 5: once the underlying source row becomes valid, Track B normalizes it normally — the old reject row remains as history", async () => {
    // Insert a deliberately-invalid fixture row (rating out of range).
    const { rows: inserted } = await fixturePool.query<{ id: number }>(
      `INSERT INTO "DataWarehouse".flipkart_reviews
         (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
       VALUES ('B', 'DEDUP_TEST_PID', 'DEDUP-TEST-1', 0, 't', 'c', CURRENT_DATE, 'u', 'a', true, 0, 'India', now(), now())
       RETURNING id`,
    );
    const sourceRowId = inserted[0]!.id;

    try {
      const firstPass = await runTrackB("flipkart");
      expect(firstPass.rowsRejected).toBeGreaterThanOrEqual(1);

      const rejectRowsBeforeFix = await IngestionReject.findAll({ where: { sourceRowId } });
      expect(rejectRowsBeforeFix.length).toBe(1); // exactly one, not accumulating

      // Now the source data becomes valid (e.g. corrected upstream).
      await fixturePool.query(
        `UPDATE "DataWarehouse".flipkart_reviews SET rating = 4, "updatedAt" = now() WHERE id = $1`,
        [sourceRowId],
      );

      const secondPass = await runTrackB("flipkart");
      const normalized = await NormalizedReview.findOne({ where: { platform: "flipkart", sourceReviewId: "DEDUP-TEST-1" } });

      expect(normalized).not.toBeNull();
      expect(normalized!.rating).toBe(4);
      expect(secondPass.rowsInserted).toBeGreaterThanOrEqual(1);

      // The historical reject row is untouched, not deleted, not duplicated.
      const rejectRowsAfterFix = await IngestionReject.findAll({ where: { sourceRowId } });
      expect(rejectRowsAfterFix.length).toBe(1);
      expect(rejectRowsAfterFix[0]!.occurrenceCount).toBe(1);
    } finally {
      await fixturePool.query(`DELETE FROM "DataWarehouse".flipkart_reviews WHERE id = $1`, [sourceRowId]);
    }
  });
});
