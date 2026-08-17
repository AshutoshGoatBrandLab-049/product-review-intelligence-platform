import { describe, it, expect } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";

/**
 * Phase 6 Step 2 — proves the exact rate-limit mechanism/handler shape used
 * by src/api/middleware/rateLimit.ts (same express-rate-limit call, same
 * 429 handler body shape), but with its OWN tiny limiter instance rather
 * than the app's shared apiRateLimiter singleton. The real apiRateLimiter is
 * a module-level export reused by every test file that imports createApp(),
 * so tightening its limit for this test would make unrelated functional
 * tests fail from cumulative request count across files, not from anything
 * they're testing (see tests/setupTestEnv.ts's comment on RATE_LIMIT_MAX).
 * This test is deliberately isolated so it can use a real, tiny limit
 * without that cross-file coupling.
 */
describe("Rate limiting (Phase 6 Step 2, §21 — isolated mechanism test)", () => {
  it("allows requests under the limit, then returns 429 once exceeded within the window", async () => {
    const testApp = express();
    testApp.use(
      rateLimit({
        windowMs: 2000,
        limit: 3,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({ error: { code: "rate_limited", message: "Too many requests — slow down." } });
        },
      }),
    );
    testApp.get("/ping", (_req, res) => res.json({ ok: true }));

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(testApp).get("/ping");
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it("429 response uses the same structured error envelope as every other API error", async () => {
    const testApp = express();
    testApp.use(
      rateLimit({
        windowMs: 2000,
        limit: 1,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({ error: { code: "rate_limited", message: "Too many requests — slow down." } });
        },
      }),
    );
    testApp.get("/ping", (_req, res) => res.json({ ok: true }));

    await request(testApp).get("/ping"); // consumes the only allowed request
    const res = await request(testApp).get("/ping");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("rate_limited");
  });

  it("resets after the window elapses", async () => {
    const testApp = express();
    testApp.use(
      rateLimit({
        windowMs: 300,
        limit: 1,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({ error: { code: "rate_limited", message: "Too many requests — slow down." } });
        },
      }),
    );
    testApp.get("/ping", (_req, res) => res.json({ ok: true }));

    const first = await request(testApp).get("/ping");
    expect(first.status).toBe(200);
    const second = await request(testApp).get("/ping");
    expect(second.status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 350));
    const third = await request(testApp).get("/ping");
    expect(third.status).toBe(200);
  });
});
