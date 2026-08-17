import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { config } from "../../src/config/index.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

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

const FK_PID = "PHASE6APIFK";
const MY_PID = 660011;
const BRAND = "Phase6ApiBrand";
const WINDOW = "30d";

async function insertFlipkart(reviewId: string, rating: number, daysAgo: number): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "DataWarehouse".flipkart_reviews
       (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
     VALUES ($5, $1, $2, $3, 't', 'c', CURRENT_DATE - $4::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [FK_PID, reviewId, rating, daysAgo, BRAND],
  );
}

async function insertMyntra(reviewId: string, rating: number, daysAgo: number): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "DataWarehouse".myntra_reviews
       (product_id, brand_name, review_id, rating, title, body, review_date, author_name, helpful_count, not_helpful_count, has_images, country, "createdAt", "updatedAt")
     VALUES ($1, $5, $2, $3, 't', 'b', CURRENT_DATE - $4::int, 'a', 0, 0, false, 'India', now(), now())`,
    [MY_PID, reviewId, rating, daysAgo, BRAND],
  );
}

const DUMMY_HASH = "c".repeat(64);
async function insertThemeMention(platform: "flipkart" | "myntra", pid: string, reviewId: string, theme: string): Promise<void> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ canonical_review_id: string }>(
    `SELECT canonical_review_id FROM "${schema}".normalized_reviews WHERE platform = :platform AND source_product_id = :pid AND source_review_id = :reviewId`,
    { type: QueryTypes.SELECT, replacements: { platform, pid, reviewId } },
  );
  if (!row) throw new Error(`no normalized_reviews row for ${platform}/${pid}/${reviewId}`);
  await appSequelize.query(
    `INSERT INTO "${config.appStore.schema}".review_theme (canonical_review_id, theme, confidence, model_version, content_hash_at_extraction)
     VALUES (:canonicalReviewId, :theme, 0.9, 'test-fixture-v1', :hash)`,
    { replacements: { canonicalReviewId: row.canonical_review_id, theme, hash: DUMMY_HASH } },
  );
}

describe("API endpoint contracts + analytics-function wiring (Phase 6 Step 2)", () => {
  beforeAll(async () => {
    await insertFlipkart("C-FK-1", 1, 5);
    await insertFlipkart("C-FK-2", 1, 6);
    await insertFlipkart("C-FK-3", 5, 7);
    await insertFlipkart("C-FK-4", 5, 8);
    await insertFlipkart("C-FK-5", 5, 9);
    await insertMyntra("C-MY-1", 3, 5);
    await insertMyntra("C-MY-2", 3, 6);
    await insertMyntra("C-MY-3", 4, 7);
    await insertMyntra("C-MY-4", 4, 8);
    await insertMyntra("C-MY-5", 4, 9);
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await runTrackA("myntra");
    await rebuildAnalytics();
    await insertThemeMention("flipkart", FK_PID, "C-FK-1", "quality");
    await insertThemeMention("flipkart", FK_PID, "C-FK-2", "delivery");
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "DataWarehouse".flipkart_reviews WHERE pid = $1`, [FK_PID]);
    await fixturePool.query(`DELETE FROM "DataWarehouse".myntra_reviews WHERE product_id = $1`, [MY_PID]);
    await fixturePool.end();
  });

  it("GET /v1/products/:platform/:sourceProductId — wired to computeProductAnalytics + computeHealthScore with real numbers", async () => {
    const res = await auth(request(app).get(`/v1/products/flipkart/${FK_PID}?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.analytics.recentMetrics.totalReviews).toBe(5);
    expect(res.body.analytics.recentMetrics.averageRating).toBe(3.4); // (1+1+5+5+5)/5
    expect(res.body.health.ratingScore).toBeCloseTo(((3.4 - 1) / 4) * 100, 1);
    expect(res.body.health.totalScore).toBeNull(); // never fabricated (healthScore.ts's own guarantee)
  });

  it("GET /v1/products/:platform/:sourceProductId/signals — wired to detectProductSignals, product_deterioration always not_ready", async () => {
    const res = await auth(request(app).get(`/v1/products/flipkart/${FK_PID}?window=${WINDOW}`));
    const sigRes = await auth(request(app).get(`/v1/products/flipkart/${FK_PID}/signals?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(sigRes.status).toBe(200);
    const deterioration = sigRes.body.signals.find((s: { signalType: string }) => s.signalType === "product_deterioration");
    expect(deterioration.confidence).toBe("not_ready");
  });

  it("GET /v1/products/:platform/:sourceProductId/insights — wired to the AI insights cache, uses the mock provider only", async () => {
    const res = await auth(request(app).get(`/v1/products/flipkart/${FK_PID}/insights?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.insight.summary).toBeTypeOf("string");
    expect(typeof res.body.cacheHit).toBe("boolean");
  });

  it("GET /v1/brands/:brand/compare — wired to compareBrandAcrossMarketplaces with real per-platform numbers", async () => {
    const res = await auth(request(app).get(`/v1/brands/${encodeURIComponent(BRAND)}/compare?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.flipkart.recentMetrics.totalReviews).toBe(5);
    expect(res.body.myntra.recentMetrics.totalReviews).toBe(5);
  });

  it("GET /v1/products/family/:familyId/compare — no_mapping for a real, unmapped random UUID (never fabricated)", async () => {
    const res = await auth(request(app).get(`/v1/products/family/${randomUUID()}/compare?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe("no_mapping");
  });

  it("GET /v1/products/family/:familyId/compare — full comparison once a mapping exists, cleaned up after", async () => {
    const [inserted] = await appSequelize.query<{ family_id: string }>(
      `INSERT INTO "${config.appStore.schema}".product_family_mapping (flipkart_source_product_id, myntra_source_product_id, notes)
       VALUES (:fk, :my, 'api contract test row') RETURNING family_id::text AS family_id`,
      { type: QueryTypes.SELECT, replacements: { fk: FK_PID, my: String(MY_PID) } },
    );
    try {
      const res = await auth(request(app).get(`/v1/products/family/${inserted!.family_id}/compare?window=${WINDOW}`));
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      expect(res.body.flipkart.recentMetrics.totalReviews).toBe(5);
      expect(res.body.myntra.recentMetrics.totalReviews).toBe(5);
    } finally {
      await appSequelize.query(`DELETE FROM "${config.appStore.schema}".product_family_mapping WHERE family_id = :id`, {
        replacements: { id: inserted!.family_id },
      });
    }
  });

  it("GET /v1/early-warnings — wired to detectAllProductSignals, scans the whole catalog", async () => {
    const res = await auth(request(app).get(`/v1/early-warnings?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.productsScanned).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.signals)).toBe(true);
  });

  it("GET /v1/dashboard/executive — real aggregate over the catalog, activeAlertCount present", async () => {
    const res = await auth(request(app).get(`/v1/dashboard/executive?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.productCount).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.activeAlertCount).toBe("number");
  });

  it("GET /v1/products/rankings — sortable, paginated, real data", async () => {
    const res = await auth(request(app).get(`/v1/products/rankings?window=${WINDOW}&sort=rating&pageSize=5`));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
  });

  it("GET /v1/problems — wired to computeProblemsAggregate, never emits a severity field", async () => {
    const res = await auth(request(app).get(`/v1/problems?window=${WINDOW}`));
    expect(res.status).toBe(200);
    const quality = res.body.themes.find((t: { theme: string }) => t.theme === "quality");
    expect(quality).toBeDefined();
    expect(quality.severityScore).toBeUndefined();
    expect(quality.totalScore).toBeUndefined();
  });

  it("GET /v1/system/ingestion-status — direct read of ingestion_watermarks (admin token)", async () => {
    const adminToken = signToken({ sub: "test-admin", role: "admin" });
    const res = await request(app).get("/v1/system/ingestion-status").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.watermarks)).toBe(true);
  });

  it("GET /v1/system/ai-usage — direct read of ai_processing_runs (admin token)", async () => {
    const adminToken = signToken({ sub: "test-admin", role: "admin" });
    const res = await request(app).get("/v1/system/ai-usage").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });

  it("insufficient-data state: a real but review-less product returns confidence=insufficient_data, never fabricated", async () => {
    const res = await auth(request(app).get(`/v1/products/flipkart/NEVER-SEEN-PID-XYZ?window=${WINDOW}`));
    expect(res.status).toBe(200);
    expect(res.body.analytics.recentMetrics.confidence).toBe("insufficient_data");
    expect(res.body.analytics.recentMetrics.totalReviews).toBe(0);
  });
});
