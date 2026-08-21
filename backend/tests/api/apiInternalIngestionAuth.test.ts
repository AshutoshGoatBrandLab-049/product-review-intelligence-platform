/**
 * POST /internal/ingestion/trigger runs a full ingestion cycle — including the
 * replacement path, which DELETES and rebuilds canonical data. It was previously
 * mounted with no authentication at all, unlike every other route in the router,
 * so anyone able to reach the port could destroy and rewrite the dataset.
 *
 * These tests pin it shut.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../../src/api/app.js";
import { config } from "../../src/config/index.js";
import { acquireLock, releaseLock } from "../../src/modules/ingestion/watermarkRepo.js";

const app = createApp();

function token(role: "admin" | "analyst" | "viewer") {
  return jwt.sign({ sub: `test-${role}`, role }, config.api.jwtSecret, { expiresIn: "5m" });
}

describe("/internal/ingestion — authorization", () => {
  it("REJECTS an unauthenticated trigger", async () => {
    const res = await request(app)
      .post("/internal/ingestion/trigger")
      .send({ platform: "flipkart" });
    expect(res.status).toBe(401);
  });

  it("REJECTS a viewer", async () => {
    const res = await request(app)
      .post("/internal/ingestion/trigger")
      .set("Authorization", `Bearer ${token("viewer")}`)
      .send({ platform: "flipkart" });
    expect(res.status).toBe(403);
  });

  it("REJECTS an analyst", async () => {
    const res = await request(app)
      .post("/internal/ingestion/trigger")
      .set("Authorization", `Bearer ${token("analyst")}`)
      .send({ platform: "flipkart" });
    expect(res.status).toBe(403);
  });

  it("REJECTS a token signed with the wrong secret", async () => {
    const forged = jwt.sign({ sub: "attacker", role: "admin" }, "not-the-real-secret", {
      expiresIn: "5m",
    });
    const res = await request(app)
      .post("/internal/ingestion/trigger")
      .set("Authorization", `Bearer ${forged}`)
      .send({ platform: "flipkart" });
    expect(res.status).toBe(401);
  });

  it("ACCEPTS an admin (reaches the handler, not the auth layer)", async () => {
    const res = await request(app)
      .post("/internal/ingestion/trigger")
      .set("Authorization", `Bearer ${token("admin")}`)
      .send({ platform: "not-a-real-platform" });
    // 400 from the handler's own validation proves auth was passed.
    expect(res.status).toBe(400);
  });

  it("leaves the health probe open (no credentials, exposes no data)", async () => {
    const res = await request(app).get("/internal/ingestion/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
  });

  it("returns 409 (not 500) when the platform lock is already held", async () => {
    // Contention between app instances is NORMAL — two backends triggered at the
    // same instant produce exactly this, and it is how duplicate processing is
    // prevented. Reporting it as 500 would page someone for the system behaving
    // correctly, and would bury real failures in the same bucket.
    await acquireLock("flipkart");
    try {
      const res = await request(app)
        .post("/internal/ingestion/trigger")
        .set("Authorization", `Bearer ${token("admin")}`)
        .send({ platform: "flipkart" });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ status: "conflict" });
      expect(res.body.message).toMatch(/already held/i);
    } finally {
      await releaseLock("flipkart");
    }
  });
});
