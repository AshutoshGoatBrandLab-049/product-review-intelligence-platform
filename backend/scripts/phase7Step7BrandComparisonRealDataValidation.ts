import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 7 — read-only validation of GET /v1/brands/:brand/compare
// against the real local dataset. This endpoint never touches AI (verified
// by source: src/api/controllers/brands.ts imports only
// compareBrandAcrossMarketplaces, no AI module) — the AI_PROVIDER guard is
// kept anyway for consistency with every other real-data validation script
// in this project and as defense in depth.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "brand-comparison-validation-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

async function checksum(): Promise<Record<string, unknown>> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<Record<string, unknown>>(
    `SELECT
       (SELECT count(*) FROM "${schema}".normalized_reviews) AS normalized_reviews,
       (SELECT md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id)) FROM "${schema}".normalized_reviews) AS checksum,
       (SELECT count(*) FROM "${schema}".ai_insights) AS ai_insights`,
    { type: QueryTypes.SELECT },
  );
  return rows[0]!;
}

async function main(): Promise<void> {
  console.log("=== Phase 7 Step 7 — Brand Marketplace Comparison real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  // "Bluepeak" is a real brand present on both platforms in the local
  // dataset (verified by direct query before writing this script: 32
  // Flipkart products, 31 Myntra products) — a meaningful two-sided case,
  // not a fabricated name.
  const res = await auth(request(app).get(`/v1/brands/${encodeURIComponent("Bluepeak")}/compare?window=30d`));
  console.log(`brand=Bluepeak, window=30d: status=${res.status}`);
  if (res.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(res.body)}`);

  const body = res.body as {
    flipkart: { productCount: number; recentMetrics: { totalReviews: number; averageRating: number | null; confidence: string } };
    myntra: { productCount: number; recentMetrics: { totalReviews: number; averageRating: number | null; confidence: string } };
    ratingComparison: { current: number; previous: number; absoluteDelta: number; percentageDelta: number | null };
    themeConsistency: Array<{ theme: string; classification: string; flipkartFrequencyPercent: number | null; myntraFrequencyPercent: number | null }>;
  };
  console.log("  flipkart:", body.flipkart.productCount, "products,", body.flipkart.recentMetrics.totalReviews, "reviews, avg", body.flipkart.recentMetrics.averageRating, "confidence", body.flipkart.recentMetrics.confidence);
  console.log("  myntra:  ", body.myntra.productCount, "products,", body.myntra.recentMetrics.totalReviews, "reviews, avg", body.myntra.recentMetrics.averageRating, "confidence", body.myntra.recentMetrics.confidence);
  console.log("  ratingComparison:", body.ratingComparison);
  console.log("  themeConsistency (first 3):", body.themeConsistency.slice(0, 3));

  // Structural proof, against the real response, that no severity/score
  // field leaked in and that themeConsistency only ever emits the three
  // documented classifications.
  const validClassifications = new Set(["marketplace_consistent", "marketplace_specific", "insufficient_evidence"]);
  for (const t of body.themeConsistency) {
    if (!validClassifications.has(t.classification)) {
      throw new Error(`DEFECT: unexpected themeConsistency classification "${t.classification}"`);
    }
  }
  if ("severity" in body || "severityScore" in body) {
    throw new Error("DEFECT: /v1/brands/:brand/compare response carries a severity-shaped field — this must never happen");
  }

  // A real, deliberately nonexistent brand — proves the honest
  // zero-products/zero-reviews path against real data, not simulated. The
  // endpoint still returns 200 with real zero values, never a 404 or a
  // fabricated non-zero placeholder.
  const emptyRes = await auth(request(app).get(`/v1/brands/${encodeURIComponent("Definitely Not A Real Brand XYZ")}/compare?window=30d`));
  console.log(`\nbrand=<nonexistent>: status=${emptyRes.status}, flipkart.productCount=${emptyRes.body.flipkart.productCount}, myntra.productCount=${emptyRes.body.myntra.productCount}`);
  if (emptyRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(emptyRes.body)}`);
  if (emptyRes.body.flipkart.productCount !== 0 || emptyRes.body.myntra.productCount !== 0) {
    throw new Error("Expected zero products on both platforms for a fabricated brand name that shouldn't exist in the real dataset");
  }
  if (emptyRes.body.flipkart.recentMetrics.averageRating !== null || emptyRes.body.myntra.recentMetrics.averageRating !== null) {
    throw new Error("DEFECT: a brand with zero reviews must have averageRating: null on both sides, never a fabricated number");
  }

  const after = await checksum();
  console.log("\n[After]", after);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(`\nDatabase state unchanged: ${unchanged}`);
  if (!unchanged) throw new Error("Database state changed — this endpoint is read-only and must never mutate data.");

  console.log("\n=== Validation complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VALIDATION FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await appSequelize.close();
  });
