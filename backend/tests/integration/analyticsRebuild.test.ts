import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { ProductDailyMetrics } from "../../src/database/appStore/models/productDailyMetrics.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

async function sumDailyReviewCount(platform: "flipkart" | "myntra"): Promise<number> {
  const rows = await ProductDailyMetrics.findAll({ where: { platform } });
  return rows.reduce((sum, r) => sum + r.reviewCount, 0);
}

async function normalizedCount(platform: "flipkart" | "myntra"): Promise<number> {
  const { NormalizedReview } = await import("../../src/database/appStore/models/normalizedReview.js");
  return NormalizedReview.count({ where: { platform } });
}

describe("analytics rebuild — determinism and no double counting (Phase 3 §17/§21)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  afterAll(async () => {
    await fixturePool.end();
  });

  it("rebuild is deterministic: two rebuilds of the same normalized_reviews state produce identical results", async () => {
    await runTrackA("flipkart");
    await runTrackA("myntra");

    const first = await rebuildAnalytics();
    const firstSum = await sumDailyReviewCount("flipkart");

    const second = await rebuildAnalytics();
    const secondSum = await sumDailyReviewCount("flipkart");

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(first.normalizedReviewsRead).toBe(second.normalizedReviewsRead);
    expect(first.productDailyMetricsRowsWritten).toBe(second.productDailyMetricsRowsWritten);
    expect(firstSum).toBe(secondSum);
  });

  it("no double counting: initial ingestion (Track A then Track B)", async () => {
    await runTrackA("flipkart");
    await runTrackB("flipkart");
    await rebuildAnalytics();

    const daily = await sumDailyReviewCount("flipkart");
    const normalized = await normalizedCount("flipkart");
    expect(daily).toBe(normalized);
  });

  it("no double counting: repeated Track B passes", async () => {
    await runTrackA("flipkart");
    await runTrackB("flipkart");
    await runTrackB("flipkart");
    await runTrackB("flipkart");
    await rebuildAnalytics();

    const daily = await sumDailyReviewCount("flipkart");
    const normalized = await normalizedCount("flipkart");
    expect(daily).toBe(normalized);
  });

  it("no double counting: cross-platform identical source IDs stay separate", async () => {
    await runTrackA("flipkart");
    await runTrackA("myntra");
    await rebuildAnalytics();

    const fkDaily = await sumDailyReviewCount("flipkart");
    const myDaily = await sumDailyReviewCount("myntra");
    const fkNorm = await normalizedCount("flipkart");
    const myNorm = await normalizedCount("myntra");
    expect(fkDaily).toBe(fkNorm);
    expect(myDaily).toBe(myNorm);
  });

  it("updatedAt-only change: rebuild still counts the review exactly once, in its original review_date bucket", async () => {
    await runTrackA("flipkart");
    await runTrackB("flipkart"); // establish baseline normalized state
    await rebuildAnalytics();
    const before = await sumDailyReviewCount("flipkart");

    // Bump updatedAt on the baseline fixture row without changing content.
    await fixturePool.query(`UPDATE "DataWarehouse".flipkart_reviews SET "updatedAt" = now() WHERE pid = 'PID001'`);
    await runTrackB("flipkart");
    await rebuildAnalytics();

    const after = await sumDailyReviewCount("flipkart");
    expect(after).toBe(before); // no new/duplicate counting from an updatedAt-only touch
  });

  it("review_date remains the historical bucket after an updatedAt-only change (never moves to today)", async () => {
    await runTrackA("flipkart");
    await fixturePool.query(`UPDATE "DataWarehouse".flipkart_reviews SET "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`);
    await runTrackB("flipkart");
    await rebuildAnalytics();

    const { rows } = await fixturePool.query<{ review_date: string }>(
      `SELECT review_date::text FROM "DataWarehouse".flipkart_reviews WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
    const originalReviewDate = rows[0]!.review_date;

    const bucket = await ProductDailyMetrics.findOne({
      where: { platform: "flipkart", sourceProductId: "PID001", reviewDate: originalReviewDate },
    });
    expect(bucket).not.toBeNull();
    expect(bucket!.reviewCount).toBeGreaterThanOrEqual(1);

    const todayBucket = await ProductDailyMetrics.findOne({
      where: { platform: "flipkart", sourceProductId: "PID001", reviewDate: new Date().toISOString().slice(0, 10) },
    });
    // Only true if the original review_date isn't today already — guard the assertion accordingly.
    if (originalReviewDate !== new Date().toISOString().slice(0, 10)) {
      expect(todayBucket).toBeNull();
    }
  });

  it("content change: rating moves from the old daily bucket count to the new one without double counting", async () => {
    await runTrackA("flipkart");
    await runTrackB("flipkart");

    await fixturePool.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET rating = 1, "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
    await runTrackB("flipkart");
    await rebuildAnalytics();

    const { rows } = await fixturePool.query<{ review_date: string }>(
      `SELECT review_date::text FROM "DataWarehouse".flipkart_reviews WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
    const bucket = await ProductDailyMetrics.findOne({
      where: { platform: "flipkart", sourceProductId: "PID001", reviewDate: rows[0]!.review_date },
    });
    expect(bucket!.rating1Count).toBeGreaterThanOrEqual(1);

    const daily = await sumDailyReviewCount("flipkart");
    const normalized = await normalizedCount("flipkart");
    expect(daily).toBe(normalized); // still exactly one contribution per canonical review

    // Restore for other tests sharing this fixture row.
    await fixturePool.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET rating = 5, "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
  });

  it("validation failure would roll back rather than ship a wrong rebuild (structural check via a clean rebuild's validationPassed flag)", async () => {
    await runTrackA("flipkart");
    const result = await rebuildAnalytics();
    expect(result.validationPassed).toBe(true);
    expect(result.status).toBe("success");
  });
});
