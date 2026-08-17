import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 3 — read-only validation of the Product Detail page's three
// endpoints (GET .../:platform/:sourceProductId, .../signals, .../insights)
// against the real local dataset. Same safety guards as the Phase 6 Step 3
// and Phase 7 Step 2 scripts: refuses to run against the isolated test
// fixture, and refuses to run unless AI_PROVIDER=mock (this script DOES
// call .../insights, unlike Step 2's — so this guard is load-bearing here,
// not just defense in depth).
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(
    `Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock". This script calls GET .../insights, ` +
      `which would otherwise make a REAL AI provider call. Re-run with AI_PROVIDER=mock.`,
  );
}

const app = createApp();
const viewerToken = signToken({ sub: "product-detail-validation-viewer", role: "viewer" });
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
  console.log("=== Phase 7 Step 3 — Product Detail real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  // A real product from the real dataset, not fabricated — picked as the
  // single highest-review-count product so the run exercises real
  // sentiment/theme/signal data rather than an edge-case empty product.
  const [productRow] = await appSequelize.query<{ platform: "flipkart" | "myntra"; source_product_id: string; brand: string | null }>(
    `SELECT pd.platform, pd.source_product_id, pd.brand
     FROM "${config.appStore.schema}".product_dimension pd
     JOIN (
       SELECT platform, source_product_id, count(*) AS review_count
       FROM "${config.appStore.schema}".normalized_reviews
       GROUP BY platform, source_product_id
       ORDER BY count(*) DESC
       LIMIT 1
     ) top ON top.platform = pd.platform AND top.source_product_id = pd.source_product_id`,
    { type: QueryTypes.SELECT },
  );
  if (!productRow) throw new Error("No real product found in the local dataset — cannot validate without one.");
  console.log(`Using real product: ${productRow.platform}/${productRow.source_product_id} (brand: ${productRow.brand})\n`);

  for (const window of ["30d", "90d"] as const) {
    console.log(`--- window=${window} ---`);

    const detailRes = await auth(request(app).get(`/v1/products/${productRow.platform}/${productRow.source_product_id}?window=${window}`));
    console.log(`GET .../${productRow.source_product_id}: status=${detailRes.status}`);
    if (detailRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(detailRes.body)}`);
    console.log(`  totalReviews=${detailRes.body.analytics.recentMetrics.totalReviews}, averageRating=${detailRes.body.analytics.recentMetrics.averageRating}, confidence=${detailRes.body.analytics.recentMetrics.confidence}`);
    console.log(`  ratingScore=${detailRes.body.health.ratingScore}, trendScore=${detailRes.body.health.trendScore}, severityScore=${detailRes.body.health.severityScore}, totalScore=${detailRes.body.health.totalScore}`);
    if (detailRes.body.health.severityScore !== null || detailRes.body.health.totalScore !== null) {
      throw new Error("DEFECT: severityScore/totalScore were not null on real data — this must never happen");
    }

    const signalsRes = await auth(request(app).get(`/v1/products/${productRow.platform}/${productRow.source_product_id}/signals?window=${window}`));
    console.log(`GET .../signals: status=${signalsRes.status}, count=${signalsRes.body.signals.length}`);
    if (signalsRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(signalsRes.body)}`);
    const byType: Record<string, string> = {};
    for (const s of signalsRes.body.signals as { signalType: string; confidence: string; evidenceReviewIds: string[] }[]) {
      byType[s.signalType] = `confidence=${s.confidence}, evidenceCount=${s.evidenceReviewIds.length}`;
    }
    console.log(`  signals: ${JSON.stringify(byType, null, 2)}`);
    console.log("");
  }

  // Insights — the one AI-touching call, mock provider only, real product,
  // real window. Cleaned up afterward so the real ai_insights table returns
  // to its documented empty state (same pattern as Phase 6 Step 3).
  console.log("--- AI insights (mock provider only) ---");
  const insightsRes = await auth(request(app).get(`/v1/products/${productRow.platform}/${productRow.source_product_id}/insights?window=30d`));
  console.log(`GET .../insights: status=${insightsRes.status}, cacheHit=${insightsRes.body.cacheHit}`);
  if (insightsRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(insightsRes.body)}`);
  console.log(`  summary: ${insightsRes.body.insight.summary}`);
  console.log(`  rootCause count=${insightsRes.body.insight.rootCause.length}, recommendations count=${insightsRes.body.insight.recommendations.length}`);
  console.log(`  citedMetrics=${JSON.stringify(insightsRes.body.insight.citedMetrics)}`);
  console.log(`  ungroundedMetrics=${JSON.stringify(insightsRes.body.insight.ungroundedMetrics)}`);

  const cleanupResult = await appSequelize.query(
    `DELETE FROM "${config.appStore.schema}".ai_insights WHERE platform = :platform AND source_product_id = :pid`,
    { replacements: { platform: productRow.platform, pid: productRow.source_product_id } },
  );
  console.log(`\nCleaned up the validation-run ai_insights row(s): ${JSON.stringify(cleanupResult[1])}`);

  const after = await checksum();
  console.log("\n[After]", after);

  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(`\nDatabase state unchanged (including ai_insights back to empty): ${unchanged}`);
  if (!unchanged) throw new Error("Database state changed and was not fully cleaned up — investigate before treating this run as safe.");

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
