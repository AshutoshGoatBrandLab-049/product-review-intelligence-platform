import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import { QueryTypes } from "sequelize";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { getOrGenerateProductInsight } from "../../src/modules/ai/insightsCache.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { config } from "../../src/config/index.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { resetAppStore } from "../helpers/resetAppStore.js";
import type { AiProvider } from "../../src/modules/ai/providers/aiProvider.js";
import type { AiAnalysisInput } from "../../src/modules/ai/types.js";
import type { ProductEvidencePackage } from "../../src/modules/ai/evidencePackage.js";

const app = createApp();
const viewerToken = signToken({ sub: "test-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

const PID = "PHASE6AICACHEPID";
const WINDOW = resolveNamedWindow("30d");

async function insertFlipkart(reviewId: string, rating: number, daysAgo: number): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "${config.appStore.schema}".flipkart_reviews
       (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
     VALUES ('AiCacheBrand', $1, $2, $3, 't', 'c', CURRENT_DATE - $4::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [PID, reviewId, rating, daysAgo],
  );
}

/** Counts every call — the whole point of this test double. Returns fixed,
 * schema-valid output so narrateProductEvidence's validation always passes. */
class CountingAiProvider implements AiProvider {
  readonly name = "counting-test-double";
  readonly modelVersion = "counting-v1";
  narrateCallCount = 0;

  async analyzeReview(_input: AiAnalysisInput): Promise<unknown> {
    throw new Error("not used in this test");
  }

  async narrate(_evidencePackage: ProductEvidencePackage): Promise<unknown> {
    this.narrateCallCount++;
    return { summary: "deterministic test summary", rootCause: [], recommendations: [] };
  }
}

describe("AI insights cache prevents duplicate provider calls (Phase 6 Step 2)", () => {
  beforeAll(async () => {
    for (let i = 0; i < 6; i++) await insertFlipkart(`AIC-${i}`, i % 2 === 0 ? 1 : 5, 5 + i);
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await rebuildAnalytics();
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid = $1`, [PID]);
    await fixturePool.end();
  });

  it("module level: getOrGenerateProductInsight calls the provider exactly once across two identical requests", async () => {
    const provider = new CountingAiProvider();

    const first = await getOrGenerateProductInsight("flipkart", PID, WINDOW, provider);
    expect(first.cacheHit).toBe(false);
    expect(provider.narrateCallCount).toBe(1);

    const second = await getOrGenerateProductInsight("flipkart", PID, WINDOW, provider);
    expect(second.cacheHit).toBe(true);
    expect(provider.narrateCallCount).toBe(1); // NOT 2 — the whole point of this test
    expect(second.result).toEqual(first.result);
  });

  it("module level: a different provider instance still hits the persisted cache (proves persistence, not just in-memory reuse)", async () => {
    const providerA = new CountingAiProvider();
    await getOrGenerateProductInsight("flipkart", PID, WINDOW, providerA);
    expect(providerA.narrateCallCount).toBe(1);

    const providerB = new CountingAiProvider();
    const result = await getOrGenerateProductInsight("flipkart", PID, WINDOW, providerB);
    expect(result.cacheHit).toBe(true);
    expect(providerB.narrateCallCount).toBe(0); // never called — the persisted row satisfied the request
  });

  it("HTTP level: two identical GET .../insights requests leave exactly one row in ai_insights", async () => {
    const first = await auth(request(app).get(`/v1/products/flipkart/${PID}/insights?window=30d`));
    expect(first.status).toBe(200);
    expect(first.body.cacheHit).toBe(false);

    const second = await auth(request(app).get(`/v1/products/flipkart/${PID}/insights?window=30d`));
    expect(second.status).toBe(200);
    expect(second.body.cacheHit).toBe(true);
    expect(second.body.insight).toEqual(first.body.insight);

    const rows = await appSequelize.query<{ count: string; result: unknown }>(
      `SELECT count(*)::text AS count, (array_agg(result))[1] AS result FROM "${config.appStore.schema}".ai_insights WHERE platform = 'flipkart' AND source_product_id = :pid`,
      { type: QueryTypes.SELECT, replacements: { pid: PID } },
    );
    expect(rows[0]!.count).toBe("1");

    // Same test, not a later one — resetAppStore() in the next test's
    // beforeEach would otherwise wipe this row before a separate test could
    // observe it. Cache stores only the VALIDATED narrator result shape
    // (summary/rootCause/recommendations/rejectedCitations), never raw
    // provider output.
    const result = rows[0]!.result as Record<string, unknown>;
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("rootCause");
    expect(result).toHaveProperty("recommendations");
    expect(result).toHaveProperty("rejectedCitations");
  });
});
