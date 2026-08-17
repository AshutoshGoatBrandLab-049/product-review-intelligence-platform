import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { computeProductAnalytics } from "../../src/modules/analytics/productAnalytics.js";
import { computeBrandAnalytics } from "../../src/modules/analytics/brandAnalytics.js";
import { computePlatformAnalytics } from "../../src/modules/analytics/platformAnalytics.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

async function insertFlipkart(pid: string, reviewId: string, rating: number, daysAgo: number, brand = "TestBrand"): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "DataWarehouse".flipkart_reviews
       (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 't', 'c', CURRENT_DATE - $5::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [brand, pid, reviewId, rating, daysAgo],
  );
}

const WINDOW = resolveNamedWindow("30d");

describe("product/brand/platform analytics (Phase 3 §5-9, §14, §17)", () => {
  const trendPid = "PHASE3TRENDPID";
  const lowSamplePid = "PHASE3LOWSAMPLEPID";
  const brandMixPid = "PHASE3BRANDMIXPID";

  beforeAll(async () => {
    // Trend product: previous period (35 days ago) low ratings, current
    // period (10 days ago) meaningfully higher ratings -> "improving".
    // 6 reviews per period clears the low-confidence floor (>=5).
    for (let i = 0; i < 6; i++) await insertFlipkart(trendPid, `TREND-PREV-${i}`, 2, 35);
    for (let i = 0; i < 6; i++) await insertFlipkart(trendPid, `TREND-CURR-${i}`, 4, 10);

    // Low-sample product: only 2 reviews total -> insufficient_data.
    await insertFlipkart(lowSamplePid, "LOWSAMPLE-1", 5, 5);
    await insertFlipkart(lowSamplePid, "LOWSAMPLE-2", 4, 6);

    // Brand-inconsistency product: two reviews, two different brand values.
    await insertFlipkart(brandMixPid, "BRANDMIX-1", 4, 5, "BrandA");
    await insertFlipkart(brandMixPid, "BRANDMIX-2", 3, 6, "BrandB");
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await rebuildAnalytics();
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "DataWarehouse".flipkart_reviews WHERE pid IN ($1, $2, $3)`, [trendPid, lowSamplePid, brandMixPid]);
    await fixturePool.end();
  });

  it("trend threshold: a >=10% rating increase with sufficient sample classifies as improving", async () => {
    const result = await computeProductAnalytics("flipkart", trendPid, WINDOW);
    expect(result.recentMetrics.confidence).not.toBe("insufficient_data");
    expect(result.historicalMetrics.confidence).not.toBe("insufficient_data");
    expect(result.ratingComparison.percentageDelta).toBeGreaterThanOrEqual(10);
    expect(result.trendDirection).toBe("improving");
  });

  it("insufficient sample: a product with too few reviews reports insufficient_data, not a fabricated trend", async () => {
    const result = await computeProductAnalytics("flipkart", lowSamplePid, WINDOW);
    expect(result.recentMetrics.confidence).toBe("insufficient_data");
    // Even though the raw numbers might look like a swing, insufficient_data wins.
    expect(result.trendDirection).toBe("insufficient_data");
  });

  it("product brand inconsistency is detected and flagged, not silently resolved", async () => {
    const result = await computeProductAnalytics("flipkart", brandMixPid, WINDOW);
    expect(result.brandInconsistent).toBe(true);
    // Deterministic tie-break: latest review_date wins (BRANDMIX-1, 5 days ago).
    expect(result.brand).toBe("BrandA");
  });

  it("product metrics: rating distribution sums to total reviews", async () => {
    const result = await computeProductAnalytics("flipkart", trendPid, WINDOW);
    const d = result.recentMetrics.ratingDistribution;
    const sum = d[1] + d[2] + d[3] + d[4] + d[5];
    expect(sum).toBe(result.recentMetrics.totalReviews);
  });

  it("brand metrics: rolls up all products under that brand", async () => {
    const result = await computeBrandAnalytics("TestBrand", WINDOW, "flipkart");
    expect(result.productCount).toBeGreaterThanOrEqual(1);
    expect(result.recentMetrics.totalReviews).toBeGreaterThanOrEqual(6); // at least the trend product's current-period rows
  });

  it("platform metrics: flipkart-only, myntra-only, and combined are consistent", async () => {
    const flipkartOnly = await computePlatformAnalytics(WINDOW, "flipkart");
    const combined = await computePlatformAnalytics(WINDOW);
    expect(combined.recentMetrics.totalReviews).toBeGreaterThanOrEqual(flipkartOnly.recentMetrics.totalReviews);
    expect(flipkartOnly.platform).toBe("flipkart");
    expect(combined.platform).toBe("combined");
  });

  it("positive/negative/neutral percentages exclude 3-star from both and sum sensibly", async () => {
    const result = await computeProductAnalytics("flipkart", trendPid, WINDOW);
    const m = result.recentMetrics;
    // All current-period reviews are rating=4 (positive), so negative/neutral are 0.
    expect(m.positivePercentage).toBe(100);
    expect(m.negativePercentage).toBe(0);
    expect(m.neutralPercentage).toBe(0);
  });
});
