import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 4 — read-only validation of GET /v1/products/rankings
// against the real local dataset. This endpoint never touches AI (verified
// by source: src/api/controllers/rankings.ts imports only
// computeCatalogHealthScores/computeCatalogAnalytics, no AI module) — the
// AI_PROVIDER guard is kept anyway for consistency with every other
// real-data validation script in this project and as defense in depth.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "rankings-validation-viewer", role: "viewer" });
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
  console.log("=== Phase 7 Step 4 — Product Rankings real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  for (const sort of ["health", "rating"] as const) {
    const res = await auth(request(app).get(`/v1/products/rankings?window=30d&sort=${sort}&pageSize=5`));
    console.log(`sort=${sort}: status=${res.status}, totalCount=${res.body.totalCount}, items.length=${res.body.items.length}`);
    if (res.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(res.body)}`);
    const first = res.body.items[0];
    if (first) {
      console.log(`  first item: ${first.platform}/${first.sourceProductId} brand=${first.brand} sortValue=${first.sortValue}`);
      if (sort === "health" && (first.data.severityScore !== null || first.data.totalScore !== null)) {
        throw new Error("DEFECT: severityScore/totalScore were not null on real data — this must never happen");
      }
    }
  }

  // Real platform filter + a real, known-nonexistent brand (exact-match
  // filter) to prove the "no products match" path against real data, not
  // a mocked one.
  const filteredRes = await auth(request(app).get(`/v1/products/rankings?window=30d&platform=flipkart&pageSize=5`));
  console.log(`\nplatform=flipkart: status=${filteredRes.status}, totalCount=${filteredRes.body.totalCount}`);

  const emptyRes = await auth(request(app).get(`/v1/products/rankings?window=30d&brand=${encodeURIComponent("Definitely Not A Real Brand XYZ")}`));
  console.log(`brand=<nonexistent>: status=${emptyRes.status}, totalCount=${emptyRes.body.totalCount}, items.length=${emptyRes.body.items.length}`);
  if (emptyRes.body.totalCount !== 0) throw new Error("Expected zero results for a fabricated brand name that shouldn't exist in the real dataset");

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
