import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";
import { categoryCCache } from "../src/api/categoryCCache.js";

// Phase 6 Step 3 — read-mostly, real-dataset API validation. Kept as a
// permanent, rerunnable deliverable (same treatment as Phase 5's tuning
// script and Phase 6's Category C benchmark).
//
// SAFETY GUARDS, both required to proceed:
//   1. Refuses to run against the isolated test fixture (this validates
//      real-scale behavior, not fixture behavior).
//   2. Refuses to run unless AI_PROVIDER=mock is explicitly set. The real
//      .env has AI_PROVIDER=gemini (checked directly, not assumed) — this
//      script calls the AI insights endpoint below, and without this guard
//      that would be a REAL Gemini call, which is explicitly forbidden this
//      step. This is a hard runtime check, not just an operator convention:
//      `AI_PROVIDER=mock npx tsx scripts/phase6ApiRealDatasetValidation.ts`.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(
    `Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock". This script exercises ` +
      `GET .../insights, which would otherwise make a REAL AI provider call. Re-run with AI_PROVIDER=mock.`,
  );
}

const app = createApp();
const adminToken = signToken({ sub: "validation-admin", role: "admin" });
const viewerToken = signToken({ sub: "validation-viewer", role: "viewer" });
const authViewer = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);
const authAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${adminToken}`);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(1)}ms`);
  return { result, ms };
}

async function checksum(): Promise<Record<string, unknown>> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<Record<string, unknown>>(
    `SELECT
       (SELECT count(*) FROM "${schema}".normalized_reviews) AS normalized_reviews,
       (SELECT md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id)) FROM "${schema}".normalized_reviews) AS checksum,
       (SELECT count(*) FROM "${schema}".review_sentiment) AS review_sentiment,
       (SELECT count(*) FROM "${schema}".review_theme) AS review_theme,
       (SELECT count(*) FROM "${schema}".product_dimension) AS product_dimension,
       (SELECT count(*) FROM "${schema}".product_family_mapping) AS product_family_mapping,
       (SELECT count(*) FROM "${schema}".ai_insights) AS ai_insights`,
    { type: QueryTypes.SELECT },
  );
  return rows[0]!;
}

async function main(): Promise<void> {
  console.log("=== Phase 6 Step 3 — real-dataset API validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  // Pick a real, high-volume brand from the real dataset (Phase 5 Step 8
  // already found qualifying real brands — reusing that same knowledge,
  // not re-deriving it) and a real product for single-product endpoints.
  const [brandRow] = await appSequelize.query<{ brand: string; product_count: string }>(
    `SELECT brand, count(*)::text AS product_count FROM "${config.appStore.schema}".product_dimension
     WHERE brand IS NOT NULL GROUP BY brand ORDER BY count(*) DESC LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  const [productRow] = await appSequelize.query<{ platform: string; source_product_id: string }>(
    `SELECT platform, source_product_id FROM "${config.appStore.schema}".product_dimension LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  console.log(`Using real brand "${brandRow!.brand}" (${brandRow!.product_count} products), real product ${productRow!.platform}/${productRow!.source_product_id}\n`);

  // --- Read-only endpoints against real data ---
  const results: Record<string, { status: number; ms: number }> = {};

  for (const [name, path] of [
    ["product detail", `/v1/products/${productRow!.platform}/${productRow!.source_product_id}?window=30d`],
    ["product signals", `/v1/products/${productRow!.platform}/${productRow!.source_product_id}/signals?window=90d`],
    ["brand compare", `/v1/brands/${encodeURIComponent(brandRow!.brand)}/compare?window=30d`],
    ["problems", `/v1/problems?window=30d`],
  ] as const) {
    const { result: res, ms } = await timed(name, () => Promise.resolve(authViewer(request(app).get(path))));
    results[name] = { status: res.status, ms };
    if (res.status !== 200) console.error(`  UNEXPECTED STATUS for ${name}:`, res.body);
  }

  // Category C endpoints — first call (miss) vs second call (hit), real scale.
  for (const [name, path] of [
    ["dashboard executive", `/v1/dashboard/executive?window=90d`],
    ["product rankings", `/v1/products/rankings?window=90d&sort=health&pageSize=10`],
    ["early warnings", `/v1/early-warnings?window=90d`],
  ] as const) {
    const first = await timed(`${name} (miss)`, () => Promise.resolve(authViewer(request(app).get(path))));
    const second = await timed(`${name} (hit)`, () => Promise.resolve(authViewer(request(app).get(path))));
    console.log(`  ${name}: cacheHit first=${first.result.body.cacheHit} second=${second.result.body.cacheHit}`);
    results[name] = { status: first.result.status, ms: first.ms };
  }

  // System endpoints — admin-only, real data.
  const ingestionStatus = await authAdmin(request(app).get("/v1/system/ingestion-status"));
  const aiUsage = await authAdmin(request(app).get("/v1/system/ai-usage"));
  console.log(`\nsystem/ingestion-status: ${ingestionStatus.status}, system/ai-usage: ${aiUsage.status}`);

  // Family compare — real, currently-empty mapping table -> must honestly report no_mapping.
  const familyRes = await authViewer(request(app).get(`/v1/products/family/00000000-0000-0000-0000-000000000000/compare?window=30d`));
  console.log(`family compare (no real mapping exists): ${familyRes.status}, available=${familyRes.body.available}, reason=${familyRes.body.reason}`);

  // --- The one write-capable endpoint: insights, using the mock provider,
  // proven end-to-end against real data, then cleaned up so the real
  // ai_insights table returns to its documented empty state. ---
  console.log("\n--- AI insights endpoint (mock provider only) against real data ---");
  const firstInsight = await authViewer(request(app).get(`/v1/products/${productRow!.platform}/${productRow!.source_product_id}/insights?window=30d`));
  console.log(`insights (miss): status=${firstInsight.status}, cacheHit=${firstInsight.body.cacheHit}`);
  const secondInsight = await authViewer(request(app).get(`/v1/products/${productRow!.platform}/${productRow!.source_product_id}/insights?window=30d`));
  console.log(`insights (hit): status=${secondInsight.status}, cacheHit=${secondInsight.body.cacheHit}`);

  const cleanupResult = await appSequelize.query(
    `DELETE FROM "${config.appStore.schema}".ai_insights WHERE platform = :platform AND source_product_id = :pid`,
    { replacements: { platform: productRow!.platform, pid: productRow!.source_product_id } },
  );
  console.log("Cleaned up the validation-run ai_insights row(s):", cleanupResult);

  categoryCCache.clear();

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
