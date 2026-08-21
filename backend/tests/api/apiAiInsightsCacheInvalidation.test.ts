import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { config } from "../../src/config/index.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

// Guard: this file persists rows into ai_insights and must never run against
// anything but the isolated test fixture.
if (config.appStore.database !== "pri_test_appstore") {
  throw new Error(`Refusing to run: config.appStore.database is "${config.appStore.database}", expected "pri_test_appstore"`);
}

const app = createApp();
const viewerToken = signToken({ sub: "test-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

const PID_X = "PHASE6INVALIDATEX";
const PID_Y = "PHASE6INVALIDATEY";
const MYNTRA_PID = 990022; // same string value as PID X/Y is impossible (numeric), used for the cross-platform case with a matching sourceProductId string instead (see test)

async function insertFlipkart(pid: string, reviewId: string, rating: number, daysAgo: number): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "${config.appStore.schema}".flipkart_reviews
       (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
     VALUES ('InvalidateBrand', $1, $2, $3, 't', 'c', CURRENT_DATE - $4::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [pid, reviewId, rating, daysAgo],
  );
}

async function insertMyntra(productId: number, reviewId: string, rating: number, daysAgo: number): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "${config.appStore.schema}".myntra_reviews
       (product_id, brand_name, review_id, rating, title, body, review_date, author_name, helpful_count, not_helpful_count, has_images, country, "createdAt", "updatedAt")
     VALUES ($1, 'InvalidateBrand', $2, $3, 't', 'b', CURRENT_DATE - $4::int, 'a', 0, 0, false, 'India', now(), now())`,
    [productId, reviewId, rating, daysAgo],
  );
}

async function ingestAll(): Promise<void> {
  await runTrackA("flipkart");
  await runTrackA("myntra");
  await rebuildAnalytics();
}

async function countAiInsightRows(platform: string, pid: string): Promise<number> {
  const rows = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${config.appStore.schema}".ai_insights WHERE platform = :platform AND source_product_id = :pid`,
    { type: QueryTypes.SELECT, replacements: { platform, pid } },
  );
  return Number(rows[0]!.count);
}

describe("AI insights cache invalidation — Cases A-D (verification pass)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid IN ($1, $2)`, [PID_X, PID_Y]);
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".myntra_reviews WHERE product_id = $1`, [MYNTRA_PID]);
    await fixturePool.end();
  });

  it("Case A: identical repeated request is a pure cache hit — persisted result returned, no new row", async () => {
    await insertFlipkart(PID_X, "A-1", 1, 5);
    await insertFlipkart(PID_X, "A-2", 5, 6);
    await insertFlipkart(PID_X, "A-3", 5, 7);
    await ingestAll();

    const first = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(first.status).toBe(200);
    expect(first.body.cacheHit).toBe(false);
    expect(await countAiInsightRows("flipkart", PID_X)).toBe(1);

    const second = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(second.status).toBe(200);
    expect(second.body.cacheHit).toBe(true);
    expect(second.body.insight).toEqual(first.body.insight);
    // Still exactly one row — the cache hit did not write a second entry.
    expect(await countAiInsightRows("flipkart", PID_X)).toBe(1);
  });

  it("Case B: changing the underlying evidence (new reviews) changes input_hash, forces a fresh narration, and does not reuse the stale cached result", async () => {
    await insertFlipkart(PID_X, "B-1", 1, 5);
    await insertFlipkart(PID_X, "B-2", 5, 6);
    await insertFlipkart(PID_X, "B-3", 5, 7);
    await ingestAll();

    const first = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(first.body.cacheHit).toBe(false);
    expect(await countAiInsightRows("flipkart", PID_X)).toBe(1);

    // Real underlying data change: reviewCount/averageRating/ratingDistribution
    // in the evidence package all change, which is exactly what
    // computeInsightInputHash hashes over — this must produce a different key.
    await insertFlipkart(PID_X, "B-4", 1, 4);
    await insertFlipkart(PID_X, "B-5", 1, 3);
    await ingestAll();

    const second = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(second.status).toBe(200);
    expect(second.body.cacheHit).toBe(false); // miss — new input_hash, not the old cached answer
    // A real, distinct second row now exists (different input_hash) — the
    // old row was never overwritten or deleted, and the new one is separate.
    expect(await countAiInsightRows("flipkart", PID_X)).toBe(2);

    // Verify the two rows really do have different input_hash values —
    // the direct mechanism, not just an inferred side effect.
    const hashes = await appSequelize.query<{ input_hash: string }>(
      `SELECT DISTINCT input_hash FROM "${config.appStore.schema}".ai_insights WHERE platform = 'flipkart' AND source_product_id = :pid`,
      { type: QueryTypes.SELECT, replacements: { pid: PID_X } },
    );
    expect(hashes.length).toBe(2);

    // Re-requesting after the change now hits the NEW cache entry, not the old one.
    const third = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(third.body.cacheHit).toBe(true);
    expect(third.body.insight).toEqual(second.body.insight);
  });

  it("Case C: a different product's cache entry never collides, even with an identical review shape", async () => {
    // PID_X and PID_Y get the EXACT same review pattern (same ratings, same
    // relative dates) — if the cache key were missing sourceProductId, this
    // would produce the same input_hash and incorrectly collide.
    for (const pid of [PID_X, PID_Y]) {
      await insertFlipkart(pid, `${pid}-1`, 1, 5);
      await insertFlipkart(pid, `${pid}-2`, 5, 6);
    }
    await ingestAll();

    const xRes = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    const yRes = await auth(request(app).get(`/v1/products/flipkart/${PID_Y}/insights?window=30d`));
    expect(xRes.body.cacheHit).toBe(false);
    expect(yRes.body.cacheHit).toBe(false); // NOT a hit off PID_X's row, despite identical evidence shape

    expect(await countAiInsightRows("flipkart", PID_X)).toBe(1);
    expect(await countAiInsightRows("flipkart", PID_Y)).toBe(1);

    // Confirm at the DB level these are two genuinely separate rows.
    const rows = await appSequelize.query<{ source_product_id: string }>(
      `SELECT source_product_id FROM "${config.appStore.schema}".ai_insights WHERE platform = 'flipkart' AND source_product_id IN (:x, :y)`,
      { type: QueryTypes.SELECT, replacements: { x: PID_X, y: PID_Y } },
    );
    expect(rows.length).toBe(2);
  });

  it("Case C (cross-platform): the same sourceProductId string on flipkart vs myntra never collides", async () => {
    const sharedId = "990022";
    await insertFlipkart(sharedId, "CP-FK-1", 1, 5);
    await insertFlipkart(sharedId, "CP-FK-2", 5, 6);
    await insertMyntra(Number(sharedId), "CP-MY-1", 3, 5);
    await insertMyntra(Number(sharedId), "CP-MY-2", 3, 6);
    await ingestAll();

    const fkRes = await auth(request(app).get(`/v1/products/flipkart/${sharedId}/insights?window=30d`));
    const myRes = await auth(request(app).get(`/v1/products/myntra/${sharedId}/insights?window=30d`));
    expect(fkRes.body.cacheHit).toBe(false);
    expect(myRes.body.cacheHit).toBe(false); // must not reuse flipkart's row for the identical sourceProductId string

    expect(await countAiInsightRows("flipkart", sharedId)).toBe(1);
    expect(await countAiInsightRows("myntra", sharedId)).toBe(1);

    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid = $1`, [sharedId]);
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".myntra_reviews WHERE product_id = $1`, [Number(sharedId)]);
  });

  it("Case D: the persisted/returned result preserves the complete NarratorResult contract", async () => {
    await insertFlipkart(PID_X, "D-1", 1, 5);
    await insertFlipkart(PID_X, "D-2", 5, 6);
    await ingestAll();

    const res = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(res.status).toBe(200);
    const insight = res.body.insight;

    // Full NarratorResult contract (narrator.ts) — every field must survive
    // the JSONB round-trip through ai_insights, not just `summary`.
    expect(insight).toHaveProperty("summary");
    expect(insight).toHaveProperty("rootCause");
    expect(insight).toHaveProperty("recommendations");
    expect(insight).toHaveProperty("rejectedCitations");
    expect(insight).toHaveProperty("irrelevantCitations");
    expect(insight).toHaveProperty("droppedUnsupportedClaims");
    expect(insight).toHaveProperty("citedMetrics");
    expect(insight).toHaveProperty("ungroundedMetrics");
    expect(Array.isArray(insight.rejectedCitations)).toBe(true);
    expect(Array.isArray(insight.irrelevantCitations)).toBe(true);
    expect(Array.isArray(insight.citedMetrics)).toBe(true);
    expect(Array.isArray(insight.ungroundedMetrics)).toBe(true);
    expect(typeof insight.droppedUnsupportedClaims).toBe("number");
    // "citations" as a standalone top-level field does not exist in the
    // NarratorResult contract — citations live inside rootCause[].evidenceReviewIds
    // and recommendations[].evidenceReviewIds, both already asserted present.
    for (const rc of insight.rootCause) expect(Array.isArray(rc.evidenceReviewIds)).toBe(true);
    for (const rec of insight.recommendations) expect(Array.isArray(rec.evidenceReviewIds)).toBe(true);

    // Same values survive a cache-hit round trip unchanged.
    const cached = await auth(request(app).get(`/v1/products/flipkart/${PID_X}/insights?window=30d`));
    expect(cached.body.cacheHit).toBe(true);
    expect(cached.body.insight).toEqual(insight);
  });
});
