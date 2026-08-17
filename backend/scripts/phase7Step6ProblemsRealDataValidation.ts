import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 7 Step 6 — read-only validation of GET /v1/problems against the
// real local dataset. This endpoint never touches AI (verified by source:
// src/api/controllers/problems.ts imports only computeProblemsAggregate,
// no AI module) — the AI_PROVIDER guard is kept anyway for consistency
// with every other real-data validation script in this project and as
// defense in depth.
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "problems-validation-viewer", role: "viewer" });
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
  console.log("=== Phase 7 Step 6 — Problems real-data validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  const res = await auth(request(app).get("/v1/problems?window=30d"));
  console.log(`window=30d: status=${res.status}, themes.length=${res.body.themes.length}`);
  if (res.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(res.body)}`);

  const themes = res.body.themes as Array<{
    theme: string;
    mentionCount: number;
    distinctReviewCount: number;
    distinctProductCount: number;
    confidence: string;
  }>;

  // Confirm the real response never carries a severity/severityScore/priority
  // field — it would be silently and wrongly available to the frontend if
  // the backend contract ever regressed on this.
  for (const t of themes) {
    if ("severity" in t || "severityScore" in t || "priority" in t) {
      throw new Error("DEFECT: /v1/problems response carries a severity-shaped field — this must never happen");
    }
  }

  // Confirm the backend's own ORDER BY count(*) DESC ordering — proves the
  // real sweep is sorted, not just asserted against synthetic test data.
  for (let i = 1; i < themes.length; i++) {
    if (themes[i]!.mentionCount > themes[i - 1]!.mentionCount) {
      throw new Error("DEFECT: /v1/problems response is not sorted by mentionCount DESC as documented");
    }
  }

  console.log("  top 3 themes:", themes.slice(0, 3));

  // Real platform filter against the real dataset.
  const flipkartRes = await auth(request(app).get("/v1/problems?window=30d&platform=flipkart"));
  console.log(`\nplatform=flipkart: status=${flipkartRes.status}, themes.length=${flipkartRes.body.themes.length}`);
  if (flipkartRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(flipkartRes.body)}`);

  // Real theme filter — a known member of THEME_VOCABULARY.
  const themeRes = await auth(request(app).get("/v1/problems?window=30d&theme=quality"));
  console.log(`theme=quality: status=${themeRes.status}, themes.length=${themeRes.body.themes.length}`);
  if (themeRes.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(themeRes.body)}`);
  for (const t of themeRes.body.themes as Array<{ theme: string }>) {
    if (t.theme !== "quality") throw new Error("DEFECT: theme=quality filter leaked a non-quality row");
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
