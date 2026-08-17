import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { resetAppStore } from "../helpers/resetAppStore.js";
import { categoryCCache } from "../../src/api/categoryCCache.js";

const app = createApp();
const viewerToken = signToken({ sub: "test-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

describe("Category C in-process TTL cache behavior (Phase 6 Step 2)", () => {
  beforeEach(async () => {
    await resetAppStore();
    categoryCCache.clear();
  });

  it("GET /v1/dashboard/executive: first call is a miss, immediate repeat is a hit", async () => {
    const first = await auth(request(app).get("/v1/dashboard/executive?window=30d"));
    expect(first.status).toBe(200);
    expect(first.body.cacheHit).toBe(false);

    const second = await auth(request(app).get("/v1/dashboard/executive?window=30d"));
    expect(second.status).toBe(200);
    expect(second.body.cacheHit).toBe(true);
    // Same underlying data on a hit — not recomputed, not different.
    expect(second.body.productCount).toBe(first.body.productCount);
  });

  it("GET /v1/products/rankings: cache key is sort/window/platform/brand-specific — different sort is a separate miss", async () => {
    const health = await auth(request(app).get("/v1/products/rankings?window=30d&sort=health"));
    expect(health.body.cacheHit).toBe(false);
    const healthAgain = await auth(request(app).get("/v1/products/rankings?window=30d&sort=health"));
    expect(healthAgain.body.cacheHit).toBe(true);

    const rating = await auth(request(app).get("/v1/products/rankings?window=30d&sort=rating"));
    expect(rating.body.cacheHit).toBe(false); // different cache key, must NOT reuse sort=health's entry
  });

  it("GET /v1/early-warnings: first call miss, repeat call hit, and dashboard's activeAlertCount reuses the same cache entry", async () => {
    const first = await auth(request(app).get("/v1/early-warnings?window=30d"));
    expect(first.body.cacheHit).toBe(false);

    const second = await auth(request(app).get("/v1/early-warnings?window=30d"));
    expect(second.body.cacheHit).toBe(true);

    // Dashboard reuses the exact same cache key for the same window —
    // calling it after early-warnings already warmed the entry should not
    // trigger a second detectAllProductSignals sweep. We can't observe
    // "cacheHit" on that inner reuse directly (dashboard's own top-level
    // cacheHit refers to its OWN key), so this asserts consistency instead:
    // activeAlertCount matches the count of non-not_ready signals from the
    // early-warnings response above.
    const dashboard = await auth(request(app).get("/v1/dashboard/executive?window=30d"));
    const expectedActive = second.body.signals.filter((s: { confidence: string }) => s.confidence !== "not_ready").length;
    expect(dashboard.body.activeAlertCount).toBe(expectedActive);
  });

  it("GET /v1/problems: cache key is window/platform/theme-specific", async () => {
    const first = await auth(request(app).get("/v1/problems?window=30d"));
    expect(first.body.cacheHit).toBe(false);
    const second = await auth(request(app).get("/v1/problems?window=30d"));
    expect(second.body.cacheHit).toBe(true);
    const filtered = await auth(request(app).get("/v1/problems?window=30d&platform=flipkart"));
    expect(filtered.body.cacheHit).toBe(false); // different filter, different key
  });

  it("Category C performance: all four endpoints respond well within a generous bound at isolated-fixture scale (PROVEN BY EXECUTION, not a production SLA claim)", async () => {
    const endpoints = ["/v1/dashboard/executive?window=30d", "/v1/products/rankings?window=30d", "/v1/early-warnings?window=30d", "/v1/problems?window=30d"];
    for (const path of endpoints) {
      const start = Date.now();
      const res = await auth(request(app).get(path));
      const elapsedMs = Date.now() - start;
      expect(res.status).toBe(200);
      // Generous bound: the real catalog-scale benchmark (1,004 products)
      // measured under 2s per operation (scripts/phase6CategoryCBenchmark.ts);
      // the isolated fixture here is far smaller, so 5s is a smoke-test
      // ceiling against a hang/regression, not a tuned performance target.
      expect(elapsedMs).toBeLessThan(5000);
    }
  });
});
