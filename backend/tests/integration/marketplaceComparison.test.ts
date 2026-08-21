import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { Pool } from "pg";
import { QueryTypes } from "sequelize";
import { randomUUID } from "node:crypto";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import {
  compareBrandAcrossMarketplaces,
  classifyThemeConsistency,
  THEME_CONSISTENCY_RATIO_BAND,
  getProductFamily,
  compareProductByFamily,
} from "../../src/modules/analytics/marketplaceComparison.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { config } from "../../src/config/index.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

// Phase 5 Step 7 — dedicated coverage for brand-level marketplace comparison
// (day-one capability) and the gated product-family-mapping path. Isolated
// fixture DB only; zero real Gemini/Anthropic calls anywhere in this file.

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

async function insertFlipkart(pid: string, reviewId: string, rating: number, daysAgo: number, brand: string): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "${config.appStore.schema}".flipkart_reviews
       (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
     VALUES ($5, $1, $2, $3, 't', 'c', CURRENT_DATE - $4::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [pid, reviewId, rating, daysAgo, brand],
  );
}

async function insertMyntra(productId: number, reviewId: string, rating: number, daysAgo: number, brand: string): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "${config.appStore.schema}".myntra_reviews
       (product_id, brand_name, review_id, rating, title, body, review_date, author_name, helpful_count, not_helpful_count, has_images, country, "createdAt", "updatedAt")
     VALUES ($1, $5, $2, $3, 't', 'b', CURRENT_DATE - $4::int, 'a', 0, 0, false, 'India', now(), now())`,
    [productId, reviewId, rating, daysAgo, brand],
  );
}

const DUMMY_HASH = "b".repeat(64);

async function insertThemeMention(platform: "flipkart" | "myntra", pid: string, reviewId: string, theme: string): Promise<void> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ canonical_review_id: string }>(
    `SELECT canonical_review_id FROM "${schema}".normalized_reviews
     WHERE platform = :platform AND source_product_id = :pid AND source_review_id = :reviewId`,
    { type: QueryTypes.SELECT, replacements: { platform, pid, reviewId } },
  );
  if (!row) throw new Error(`insertThemeMention: no normalized_reviews row for ${platform}/${pid}/${reviewId}`);
  await appSequelize.query(
    `INSERT INTO "${schema}".review_theme (canonical_review_id, theme, confidence, model_version, content_hash_at_extraction)
     VALUES (:canonicalReviewId, :theme, 0.9, 'test-fixture-v1', :hash)`,
    { replacements: { canonicalReviewId: row.canonical_review_id, theme, hash: DUMMY_HASH } },
  );
}

const WINDOW = resolveNamedWindow("30d");
const BRAND = "FamCompareBrand";
const FK_PID = "PHASE5MCFLIPKART";
const MY_PID = 550111;

describe("classifyThemeConsistency (pure function — all three §15 buckets)", () => {
  it("returns insufficient_evidence when either side's sample size is below the floor", () => {
    const result = classifyThemeConsistency(50, 3, 50, 100, 5);
    expect(result).toBe("insufficient_evidence");
  });

  it("returns marketplace_consistent when frequencies are within the ratio band", () => {
    const result = classifyThemeConsistency(20, 100, 25, 100, 5, THEME_CONSISTENCY_RATIO_BAND);
    expect(result).toBe("marketplace_consistent");
  });

  it("returns marketplace_specific when frequencies exceed the ratio band (or one side is zero) despite adequate sample size", () => {
    const skewed = classifyThemeConsistency(60, 100, 10, 100, 5, THEME_CONSISTENCY_RATIO_BAND);
    expect(skewed).toBe("marketplace_specific");

    const oneSidedZero = classifyThemeConsistency(15, 100, 0, 100, 5, THEME_CONSISTENCY_RATIO_BAND);
    expect(oneSidedZero).toBe("marketplace_specific");
  });
});

describe("marketplace comparison (Phase 5 Step 7 — real DB integration)", () => {
  beforeAll(async () => {
    // Flipkart: 6 reviews, avg rating 4.5, theme 'quality' on 3, 'delivery' on 1.
    await insertFlipkart(FK_PID, "FK-1", 5, 5, BRAND);
    await insertFlipkart(FK_PID, "FK-2", 5, 6, BRAND);
    await insertFlipkart(FK_PID, "FK-3", 5, 7, BRAND);
    await insertFlipkart(FK_PID, "FK-4", 4, 8, BRAND);
    await insertFlipkart(FK_PID, "FK-5", 4, 9, BRAND);
    await insertFlipkart(FK_PID, "FK-6", 4, 10, BRAND);

    // Myntra: 6 reviews, avg rating ~2.67, theme 'quality' on 3 (same ratio as
    // Flipkart -> consistent), 'delivery' on none (present only on Flipkart -> specific).
    await insertMyntra(MY_PID, "MY-1", 3, 5, BRAND);
    await insertMyntra(MY_PID, "MY-2", 3, 6, BRAND);
    await insertMyntra(MY_PID, "MY-3", 3, 7, BRAND);
    await insertMyntra(MY_PID, "MY-4", 3, 8, BRAND);
    await insertMyntra(MY_PID, "MY-5", 2, 9, BRAND);
    await insertMyntra(MY_PID, "MY-6", 2, 10, BRAND);
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await runTrackA("myntra");
    await rebuildAnalytics();

    await insertThemeMention("flipkart", FK_PID, "FK-1", "quality");
    await insertThemeMention("flipkart", FK_PID, "FK-2", "quality");
    await insertThemeMention("flipkart", FK_PID, "FK-3", "quality");
    await insertThemeMention("flipkart", FK_PID, "FK-4", "delivery");

    await insertThemeMention("myntra", String(MY_PID), "MY-1", "quality");
    await insertThemeMention("myntra", String(MY_PID), "MY-2", "quality");
    await insertThemeMention("myntra", String(MY_PID), "MY-3", "quality");
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid = $1`, [FK_PID]);
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".myntra_reviews WHERE product_id = $1`, [MY_PID]);
    // fixturePool stays open — it's shared with the product-family-mapping
    // describe block below, which closes it in its own afterAll.
  });

  it("compareBrandAcrossMarketplaces returns both sides' real analytics and a correct rating gap", async () => {
    const result = await compareBrandAcrossMarketplaces(BRAND, WINDOW);
    expect(result.flipkart.recentMetrics.totalReviews).toBe(6);
    expect(result.myntra.recentMetrics.totalReviews).toBe(6);
    expect(result.flipkart.recentMetrics.averageRating).toBe(4.5);
    expect(result.myntra.recentMetrics.averageRating).toBeCloseTo(2.67, 1);
    expect(result.ratingComparison.current).toBe(result.flipkart.recentMetrics.averageRating);
    expect(result.ratingComparison.previous).toBe(result.myntra.recentMetrics.averageRating);
    expect(result.ratingComparison.absoluteDelta).toBeGreaterThan(0); // flipkart rates higher than myntra here
  });

  it("compareBrandAcrossMarketplaces classifies 'quality' as marketplace_consistent (equal frequency both sides)", async () => {
    const result = await compareBrandAcrossMarketplaces(BRAND, WINDOW);
    const quality = result.themeConsistency.find((t) => t.theme === "quality");
    expect(quality).toBeDefined();
    expect(quality?.flipkartSampleSize).toBe(6);
    expect(quality?.myntraSampleSize).toBe(6);
    expect(quality?.classification).toBe("marketplace_consistent");
  });

  it("compareBrandAcrossMarketplaces classifies 'delivery' as marketplace_specific (present on Flipkart only)", async () => {
    const result = await compareBrandAcrossMarketplaces(BRAND, WINDOW);
    const delivery = result.themeConsistency.find((t) => t.theme === "delivery");
    expect(delivery).toBeDefined();
    expect(delivery?.flipkartFrequencyPercent).toBeGreaterThan(0);
    expect(delivery?.myntraFrequencyPercent).toBe(0);
    expect(delivery?.classification).toBe("marketplace_specific");
  });
});

describe("product-family-mapping (Phase 5 Step 7 — gated product-level path, permanent regression coverage)", () => {
  // Reuses the brand fixture's ingested products (FK_PID / MY_PID) — this
  // describe block runs after the fixture above has inserted+ingested them
  // within the same file's beforeEach cadence, so a fresh resetAppStore +
  // re-ingest happens per test here too.
  beforeAll(async () => {
    await insertFlipkart(FK_PID, "FAM-FK-1", 5, 5, BRAND);
    await insertFlipkart(FK_PID, "FAM-FK-2", 4, 6, BRAND);
    await insertFlipkart(FK_PID, "FAM-FK-3", 5, 7, BRAND);
    await insertFlipkart(FK_PID, "FAM-FK-4", 4, 8, BRAND);
    await insertFlipkart(FK_PID, "FAM-FK-5", 5, 9, BRAND);

    await insertMyntra(MY_PID, "FAM-MY-1", 3, 5, BRAND);
    await insertMyntra(MY_PID, "FAM-MY-2", 2, 6, BRAND);
    await insertMyntra(MY_PID, "FAM-MY-3", 3, 7, BRAND);
    await insertMyntra(MY_PID, "FAM-MY-4", 2, 8, BRAND);
    await insertMyntra(MY_PID, "FAM-MY-5", 3, 9, BRAND);
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await runTrackA("myntra");
    await rebuildAnalytics();
  });

  afterEach(async () => {
    // Standing instruction: product_family_mapping must remain genuinely
    // empty outside of this test's own scope. Unconditional cleanup even if
    // an assertion above throws mid-test.
    await appSequelize.query(`DELETE FROM "${config.appStore.schema}".product_family_mapping`);
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid = $1`, [FK_PID]);
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".myntra_reviews WHERE product_id = $1`, [MY_PID]);
    await fixturePool.end();
  });

  it("getProductFamily returns null and compareProductByFamily returns no_mapping when the table is empty", async () => {
    const family = await getProductFamily("flipkart", FK_PID);
    expect(family).toBeNull();

    const bogusFamilyId = randomUUID();
    const result = await compareProductByFamily(bogusFamilyId, WINDOW);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe("no_mapping");
  });

  it("compareProductByFamily returns a full, correct comparison once a mapping row exists — never fuzzy-matched, only exact lookup", async () => {
    const [inserted] = await appSequelize.query<{ family_id: string }>(
      `INSERT INTO "${config.appStore.schema}".product_family_mapping
         (flipkart_source_product_id, myntra_source_product_id, notes)
       VALUES (:fk, :my, 'Step 7 permanent test row')
       RETURNING family_id::text AS family_id`,
      { type: QueryTypes.SELECT, replacements: { fk: FK_PID, my: String(MY_PID) } },
    );
    const familyId = inserted!.family_id;

    const foundByFlipkart = await getProductFamily("flipkart", FK_PID);
    const foundByMyntra = await getProductFamily("myntra", String(MY_PID));
    expect(foundByFlipkart?.familyId).toBe(familyId);
    expect(foundByMyntra?.familyId).toBe(familyId);

    const comparison = await compareProductByFamily(familyId, WINDOW);
    expect(comparison.available).toBe(true);
    if (comparison.available) {
      expect(comparison.flipkartSourceProductId).toBe(FK_PID);
      expect(comparison.myntraSourceProductId).toBe(String(MY_PID));
      expect(comparison.flipkart.recentMetrics.totalReviews).toBe(5);
      expect(comparison.myntra.recentMetrics.totalReviews).toBe(5);
    }
  });

  it("a family with only one platform's product ingested still resolves the mapping, and returns insufficient_data (never fabricated) for the missing side", async () => {
    const unmappedMyntraPid = "999999999";
    const [inserted] = await appSequelize.query<{ family_id: string }>(
      `INSERT INTO "${config.appStore.schema}".product_family_mapping
         (flipkart_source_product_id, myntra_source_product_id, notes)
       VALUES (:fk, :my, 'Step 7 permanent test row — one-sided')
       RETURNING family_id::text AS family_id`,
      { type: QueryTypes.SELECT, replacements: { fk: FK_PID, my: unmappedMyntraPid } },
    );
    const familyId = inserted!.family_id;

    const comparison = await compareProductByFamily(familyId, WINDOW);
    expect(comparison.available).toBe(true);
    if (comparison.available) {
      expect(comparison.flipkart.recentMetrics.totalReviews).toBe(5);
      expect(comparison.myntra.recentMetrics.totalReviews).toBe(0);
      expect(comparison.myntra.recentMetrics.confidence).toBe("insufficient_data");
    }
  });
});
