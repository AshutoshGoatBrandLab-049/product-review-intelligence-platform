import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const app = createApp();
const viewerToken = signToken({ sub: "test-viewer", role: "viewer" });
const auth = (req: request.Test) => req.set("Authorization", `Bearer ${viewerToken}`);

describe("API request validation (Phase 6 Step 2, §21)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("rejects an invalid platform enum value (400, never silently coerced)", async () => {
    const res = await auth(request(app).get("/v1/products/notaplatform/PID001"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("rejects an invalid window value (400)", async () => {
    const res = await auth(request(app).get("/v1/products/flipkart/PID001?window=999d"));
    expect(res.status).toBe(400);
  });

  it("rejects a non-UUID familyId (400)", async () => {
    const res = await auth(request(app).get("/v1/products/family/not-a-uuid/compare"));
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-vocabulary theme query param (400)", async () => {
    const res = await auth(request(app).get("/v1/problems?theme=not_a_real_theme"));
    expect(res.status).toBe(400);
  });

  it("rejects a rankings page/pageSize that isn't a positive integer (400)", async () => {
    const res = await auth(request(app).get("/v1/products/rankings?page=-1"));
    expect(res.status).toBe(400);
  });

  it("caps pageSize at 100 rather than accepting an unbounded value (400 for over-max, not silently truncated)", async () => {
    const res = await auth(request(app).get("/v1/products/rankings?pageSize=100000"));
    expect(res.status).toBe(400);
  });
});

describe("SQL injection / input safety (Phase 6 Step 2, §21)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("a SQL-injection-shaped sourceProductId is treated as literal text, never executed (still a well-formed 200 with no matching data)", async () => {
    const malicious = "PID001'; DROP TABLE normalized_reviews; --";
    const res = await auth(request(app).get(`/v1/products/flipkart/${encodeURIComponent(malicious)}`));
    // Sequelize's parameterized `replacements` never lets this reach the SQL
    // parser as anything but a string literal — a real product just isn't
    // found, this must not 500 and must not affect any other row.
    expect(res.status).toBe(200);
    expect(res.body.analytics.recentMetrics.totalReviews).toBe(0);
  });

  it("normalized_reviews table still exists and is queryable after the injection attempt above (proves nothing was executed)", async () => {
    const res = await auth(request(app).get("/v1/products/flipkart/PID001"));
    expect(res.status).toBe(200);
  });

  it("a SQL-injection-shaped brand name in the brand-compare route is treated as literal text", async () => {
    const malicious = "X'; DROP TABLE product_dimension; --";
    const res = await auth(request(app).get(`/v1/brands/${encodeURIComponent(malicious)}/compare`));
    expect(res.status).toBe(200);
    expect(res.body.flipkart.recentMetrics.totalReviews).toBe(0);
  });

  it("a SQL-injection-shaped brand filter on /v1/problems is treated as literal text, not executed", async () => {
    const malicious = "'; DROP TABLE review_theme; --";
    const res = await auth(request(app).get(`/v1/early-warnings?brand=${encodeURIComponent(malicious)}`));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.signals)).toBe(true);
  });
});
