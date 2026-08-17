import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 5 — read-only validation of GET /v1/early-warnings against
// the real local dataset. This endpoint never touches AI (verified by
// source: src/api/controllers/earlyWarnings.ts imports only
// detectAllProductSignals, no AI module) — the AI_PROVIDER guard is kept
// anyway for consistency with every other real-data validation script in
// this project and as defense in depth.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "warnings-validation-viewer", role: "viewer" });
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
  console.log("=== Phase 7 Step 5 — Early Warnings real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  const res = await auth(request(app).get("/v1/early-warnings?window=30d"));
  console.log(`window=30d: status=${res.status}, productsScanned=${res.body.productsScanned}, signals.length=${res.body.signals.length}`);
  if (res.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(res.body)}`);

  const confidenceCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const s of res.body.signals as Array<{ confidence: string; signalType: string }>) {
    confidenceCounts[s.confidence] = (confidenceCounts[s.confidence] ?? 0) + 1;
    typeCounts[s.signalType] = (typeCounts[s.signalType] ?? 0) + 1;
  }
  console.log("  confidence breakdown:", confidenceCounts);
  console.log("  signalType breakdown:", typeCounts);

  // product_deterioration must only ever appear as not_ready — never as an
  // active/fired warning. This proves it against the real signal sweep,
  // not just a unit test with synthetic data.
  const activeDeterioration = (res.body.signals as Array<{ signalType: string; confidence: string }>).filter(
    (s) => s.signalType === "product_deterioration" && s.confidence !== "not_ready",
  );
  if (activeDeterioration.length > 0) {
    throw new Error("DEFECT: product_deterioration fired as an active signal — this must never happen");
  }

  // Real platform filter against the real dataset.
  const flipkartRes = await auth(request(app).get("/v1/early-warnings?window=30d&platform=flipkart"));
  console.log(`\nplatform=flipkart: status=${flipkartRes.status}, signals.length=${flipkartRes.body.signals.length}`);
  if (flipkartRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(flipkartRes.body)}`);
  for (const s of flipkartRes.body.signals as Array<{ platform: string }>) {
    if (s.platform !== "flipkart") throw new Error("DEFECT: platform=flipkart filter leaked a non-flipkart signal");
  }

  // Real, known-nonexistent brand — the honest "no products match" path
  // against real data, not a mocked one.
  const emptyRes = await auth(request(app).get(`/v1/early-warnings?window=30d&brand=${encodeURIComponent("Definitely Not A Real Brand XYZ")}`));
  console.log(`brand=<nonexistent>: status=${emptyRes.status}, signals.length=${emptyRes.body.signals.length}`);
  if (emptyRes.body.signals.length !== 0) throw new Error("Expected zero signals for a fabricated brand name that shouldn't exist in the real dataset");

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
