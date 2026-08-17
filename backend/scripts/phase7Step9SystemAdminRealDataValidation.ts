import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 9 — read-only validation of GET /v1/system/ingestion-status
// and GET /v1/system/ai-usage against the real local dataset. Both
// endpoints are direct SELECTs (verified by source:
// src/api/controllers/system.ts has no INSERT/UPDATE/DELETE anywhere) and
// neither touches AI (no AI module imported) — the AI_PROVIDER guard is
// kept anyway for consistency with every other real-data validation
// script in this project and as defense in depth.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const adminToken = signToken({ sub: "system-validation-admin", role: "admin" });
const viewerToken = signToken({ sub: "system-validation-viewer", role: "viewer" });
const analystToken = signToken({ sub: "system-validation-analyst", role: "analyst" });

async function checksum(): Promise<Record<string, unknown>> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<Record<string, unknown>>(
    `SELECT
       (SELECT count(*) FROM "${schema}".normalized_reviews) AS normalized_reviews,
       (SELECT md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id)) FROM "${schema}".normalized_reviews) AS checksum,
       (SELECT count(*) FROM "${schema}".ai_insights) AS ai_insights,
       (SELECT count(*) FROM "${schema}".product_family_mapping) AS product_family_mapping,
       (SELECT count(*) FROM "${schema}".ingestion_watermarks) AS ingestion_watermarks,
       (SELECT count(*) FROM "${schema}".ai_processing_runs) AS ai_processing_runs`,
    { type: QueryTypes.SELECT },
  );
  return rows[0]!;
}

async function main(): Promise<void> {
  console.log("=== Phase 7 Step 9 — System/Admin real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  // RBAC — admin succeeds, viewer/analyst are really rejected server-side
  // (the frontend's RequireRole is UX only; this is the authoritative check).
  const adminIngestionRes = await request(app).get("/v1/system/ingestion-status").set("Authorization", `Bearer ${adminToken}`);
  console.log(`admin GET /v1/system/ingestion-status: status=${adminIngestionRes.status}, watermarks.length=${adminIngestionRes.body.watermarks?.length}`);
  if (adminIngestionRes.status !== 200) throw new Error(`Expected 200 for admin, got ${adminIngestionRes.status}`);
  console.log("  watermarks:", adminIngestionRes.body.watermarks);

  const adminAiUsageRes = await request(app).get("/v1/system/ai-usage").set("Authorization", `Bearer ${adminToken}`);
  console.log(`\nadmin GET /v1/system/ai-usage: status=${adminAiUsageRes.status}, runs.length=${adminAiUsageRes.body.runs?.length}`);
  if (adminAiUsageRes.status !== 200) throw new Error(`Expected 200 for admin, got ${adminAiUsageRes.status}`);
  if (adminAiUsageRes.body.runs?.length > 50) throw new Error("DEFECT: /v1/system/ai-usage returned more than the documented 50-row bound");

  const viewerIngestionRes = await request(app).get("/v1/system/ingestion-status").set("Authorization", `Bearer ${viewerToken}`);
  console.log(`\nviewer GET /v1/system/ingestion-status: status=${viewerIngestionRes.status}`);
  if (viewerIngestionRes.status !== 403) throw new Error(`DEFECT: expected 403 for viewer, got ${viewerIngestionRes.status}`);

  const analystAiUsageRes = await request(app).get("/v1/system/ai-usage").set("Authorization", `Bearer ${analystToken}`);
  console.log(`analyst GET /v1/system/ai-usage: status=${analystAiUsageRes.status}`);
  if (analystAiUsageRes.status !== 403) throw new Error(`DEFECT: expected 403 for analyst, got ${analystAiUsageRes.status}`);

  const noAuthRes = await request(app).get("/v1/system/ingestion-status");
  console.log(`no Authorization header GET /v1/system/ingestion-status: status=${noAuthRes.status}`);
  if (noAuthRes.status !== 401) throw new Error(`DEFECT: expected 401 with no Authorization header, got ${noAuthRes.status}`);

  const after = await checksum();
  console.log("\n[After]", after);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(`\nDatabase state unchanged: ${unchanged}`);
  if (!unchanged) throw new Error("Database state changed — both endpoints are read-only and must never mutate data.");

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
