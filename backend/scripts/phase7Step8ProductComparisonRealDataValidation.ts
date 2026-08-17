import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 8 — read-only validation of
// GET /v1/products/family/:familyId/compare against the real local
// dataset. This endpoint never touches AI (verified by source:
// src/api/controllers/marketplace.ts imports only compareProductByFamily,
// no AI module) — the AI_PROVIDER guard is kept anyway for consistency
// with every other real-data validation script in this project and as
// defense in depth. This script never creates, updates, deletes, or seeds
// any product_family_mapping row — it only reads.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "product-comparison-validation-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

async function checksum(): Promise<Record<string, unknown>> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<Record<string, unknown>>(
    `SELECT
       (SELECT count(*) FROM "${schema}".normalized_reviews) AS normalized_reviews,
       (SELECT md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id)) FROM "${schema}".normalized_reviews) AS checksum,
       (SELECT count(*) FROM "${schema}".ai_insights) AS ai_insights,
       (SELECT count(*) FROM "${schema}".product_family_mapping) AS product_family_mapping`,
    { type: QueryTypes.SELECT },
  );
  return rows[0]!;
}

async function main(): Promise<void> {
  console.log("=== Phase 7 Step 8 — Product Marketplace Comparison real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  if (before.product_family_mapping !== "0") {
    console.log(
      `NOTE: product_family_mapping has ${before.product_family_mapping} row(s), not the expected 0 — someone deliberately populated it since the Step 5/6/7 reports. This script adapts and reports the real state either way; it does not assume emptiness.`,
    );
  }

  // A real, syntactically-valid UUID that is guaranteed not to be a real
  // family (product_family_mapping is empty, or if it isn't, this specific
  // all-zero UUID is not a value any real row would use) — proves the
  // honest no_mapping path against the real endpoint, not simulated.
  const noMappingFamilyId = "00000000-0000-0000-0000-000000000000";
  const res = await auth(request(app).get(`/v1/products/family/${noMappingFamilyId}/compare?window=30d`));
  console.log(`familyId=<all-zero UUID>, window=30d: status=${res.status}`);
  if (res.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(res.body)}`);
  console.log("  response:", res.body);
  if (res.body.available !== false || res.body.reason !== "no_mapping") {
    throw new Error(`DEFECT: expected { available: false, reason: "no_mapping" } for an unmapped familyId, got ${JSON.stringify(res.body)}`);
  }

  // A syntactically-invalid familyId (not a UUID) — proves the real
  // FamilyParamsSchema validation path (400) against the real running app,
  // not assumed from reading the schema alone.
  const invalidRes = await auth(request(app).get("/v1/products/family/not-a-uuid/compare?window=30d"));
  console.log(`\nfamilyId=<invalid UUID>: status=${invalidRes.status}`);
  if (invalidRes.status !== 400) throw new Error(`Expected 400 for a non-UUID familyId, got ${invalidRes.status}`);

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
