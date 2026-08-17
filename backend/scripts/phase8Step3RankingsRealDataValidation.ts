import request from "supertest";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { createApp } from "../src/api/app.js";
import { signToken } from "../src/api/auth/jwt.js";

// Phase 8 Step 3 — read-only re-validation of GET /v1/products/rankings
// against the real local dataset, for the Product Rankings UI
// transformation. The backend contract itself was not touched this step
// (frontend-only change) — this script exists to re-confirm the exact
// same real-data guarantees the Phase 7 Step 4 script already proved
// (severityScore/totalScore null, platform/brand filtering, catalog
// count), plus pagination across a second page, which that script didn't
// yet cover. AI_PROVIDER guard kept for consistency/defense-in-depth —
// this endpoint has no AI code path (verified by source, unchanged since
// Step 4: rankings.ts imports only computeCatalogHealthScores/
// computeCatalogAnalytics).
if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this script validates the real dataset, not the isolated test fixture");
}
if (config.ai.provider !== "mock") {
  throw new Error(`Refusing to run: config.ai.provider is "${config.ai.provider}", not "mock".`);
}

const app = createApp();
const viewerToken = signToken({ sub: "rankings-step3-validation-viewer", role: "viewer" });
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
  console.log("=== Phase 8 Step 3 — Product Rankings real-data re-validation ===\n");

  const before = await checksum();
  console.log("[Before]", before, "\n");

  for (const sort of ["health", "rating"] as const) {
    const res = await auth(request(app).get(`/v1/products/rankings?window=30d&sort=${sort}&pageSize=5`));
    console.log(`sort=${sort}: status=${res.status}, totalCount=${res.body.totalCount}, items.length=${res.body.items.length}`);
    if (res.status !== 200) throw new Error(`Unexpected status: ${JSON.stringify(res.body)}`);
    const first = res.body.items[0];
    if (first) {
      console.log(`  first item: ${first.platform}/${first.sourceProductId} brand=${first.brand} sortValue=${first.sortValue}`);
      if (sort === "health") {
        if (first.data.severityScore !== null || first.data.totalScore !== null) {
          throw new Error("DEFECT: severityScore/totalScore were not null on real data — this must never happen");
        }
        if (typeof first.data.trendScore !== "number") throw new Error("DEFECT: trendScore missing/not a number on real data");
      } else {
        if (!("trendDirection" in first.data)) throw new Error("DEFECT: trendDirection missing on real ProductAnalytics data");
      }
    }
  }

  // Pagination — page 2 should return a disjoint set of products from
  // page 1 (proves real backend pagination, not a client-side slice of
  // the same page repeated). Does NOT throw on overlap — see the DEFECT
  // log below and the Phase 8 Step 3 report §24: this is a real backend
  // behavior (products tied at the maximum sortValue can appear on both
  // sides of a page boundary), discovered by this script, and is not
  // something Step 3 is authorized to fix (frontend-only scope) — the
  // script's job is to detect and report it truthfully, not to fail in a
  // way that blocks the rest of this read-only validation from completing.
  const page1 = await auth(request(app).get("/v1/products/rankings?window=30d&sort=health&pageSize=5&page=1"));
  const page2 = await auth(request(app).get("/v1/products/rankings?window=30d&sort=health&pageSize=5&page=2"));
  console.log(`\npage=1: status=${page1.status}, totalCount=${page1.body.totalCount}`);
  console.log(`page=2: status=${page2.status}, totalCount=${page2.body.totalCount}`);
  const page1Ids = new Set(page1.body.items.map((i: { sourceProductId: string }) => i.sourceProductId));
  const overlap = page2.body.items.filter((i: { sourceProductId: string }) => page1Ids.has(i.sourceProductId));
  if (overlap.length > 0) {
    console.log(
      `DEFECT (pre-existing, backend-side, NOT introduced by Phase 8 Step 3, NOT fixed — out of this step's frontend-only scope): ` +
        `page 2 overlaps with page 1 (${overlap.length} duplicate item(s): ${overlap.map((i: { sourceProductId: string }) => i.sourceProductId).join(", ")}). ` +
        `Likely cause: multiple products tied at the same maximum sortValue, with no stable secondary sort key in rankings.ts's comparator.`,
    );
  } else {
    console.log("Pagination check: no overlap between page 1 and page 2.");
  }

  // Real platform filter + a real, known-nonexistent brand (exact-match
  // filter) to prove the "no products match" path against real data.
  const filteredRes = await auth(request(app).get("/v1/products/rankings?window=30d&platform=flipkart&pageSize=5"));
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
