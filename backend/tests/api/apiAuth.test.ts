import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const app = createApp();

function tokenFor(role: "admin" | "analyst" | "viewer"): string {
  return signToken({ sub: `test-${role}`, role });
}

describe("API auth/RBAC (Phase 6 Step 2)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("rejects a request with no Authorization header (401)", async () => {
    const res = await request(app).get("/v1/products/flipkart/PID001");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects a malformed Authorization header (401)", async () => {
    const res = await request(app).get("/v1/products/flipkart/PID001").set("Authorization", "NotBearer sometoken");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid/garbage JWT (401)", async () => {
    const res = await request(app).get("/v1/products/flipkart/PID001").set("Authorization", "Bearer not.a.real.jwt");
    expect(res.status).toBe(401);
  });

  it("rejects a JWT signed with a different secret (401)", async () => {
    const jwt = await import("jsonwebtoken");
    const forged = jwt.default.sign({ sub: "attacker", role: "admin" }, "wrong-secret", { expiresIn: "1h" });
    const res = await request(app).get("/v1/products/flipkart/PID001").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("rejects an expired JWT (401)", async () => {
    const jwt = await import("jsonwebtoken");
    const { config } = await import("../../src/config/index.js");
    const expired = jwt.default.sign({ sub: "test", role: "viewer" }, config.api.jwtSecret, { expiresIn: -10 });
    const res = await request(app).get("/v1/products/flipkart/PID001").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token for any of the three roles on a non-admin-only route (200)", async () => {
    for (const role of ["admin", "analyst", "viewer"] as const) {
      const res = await request(app).get("/v1/products/flipkart/PID001").set("Authorization", `Bearer ${tokenFor(role)}`);
      expect(res.status).toBe(200);
    }
  });

  it("admin-only route (/v1/system/ingestion-status): viewer and analyst get 403, admin gets 200", async () => {
    const viewerRes = await request(app).get("/v1/system/ingestion-status").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(viewerRes.status).toBe(403);
    expect(viewerRes.body.error.code).toBe("forbidden");

    const analystRes = await request(app).get("/v1/system/ingestion-status").set("Authorization", `Bearer ${tokenFor("analyst")}`);
    expect(analystRes.status).toBe(403);

    const adminRes = await request(app).get("/v1/system/ingestion-status").set("Authorization", `Bearer ${tokenFor("admin")}`);
    expect(adminRes.status).toBe(200);
  });

  it("admin-only route (/v1/system/ai-usage): same RBAC boundary", async () => {
    const viewerRes = await request(app).get("/v1/system/ai-usage").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(viewerRes.status).toBe(403);

    const adminRes = await request(app).get("/v1/system/ai-usage").set("Authorization", `Bearer ${tokenFor("admin")}`);
    expect(adminRes.status).toBe(200);
  });

  it("a token with an unrecognized role is rejected (401, not silently accepted)", async () => {
    const jwt = await import("jsonwebtoken");
    const { config } = await import("../../src/config/index.js");
    const badRole = jwt.default.sign({ sub: "test", role: "superuser" }, config.api.jwtSecret, { expiresIn: "1h" });
    const res = await request(app).get("/v1/products/flipkart/PID001").set("Authorization", `Bearer ${badRole}`);
    expect(res.status).toBe(401);
  });
});
