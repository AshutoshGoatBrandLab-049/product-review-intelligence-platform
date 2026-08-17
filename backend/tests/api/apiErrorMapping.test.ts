import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/api/app.js";
import { signToken } from "../../src/api/auth/jwt.js";
import { errorHandler } from "../../src/api/middleware/errorHandler.js";
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from "../../src/api/errors.js";
import { AiProviderError } from "../../src/modules/ai/providers/aiProvider.js";

const app = createApp();
const viewerToken = signToken({ sub: "test-viewer", role: "viewer" });

describe("Error mapping — real app-level status codes (Phase 6 Step 2)", () => {
  it("unknown route returns 404 with a structured error envelope", async () => {
    const res = await request(app).get("/v1/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("missing auth returns 401 with a structured error envelope", async () => {
    const res = await request(app).get("/v1/products/flipkart/PID001");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized" });
  });

  it("wrong role returns 403 with a structured error envelope", async () => {
    const res = await request(app).get("/v1/system/ai-usage").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "forbidden" });
  });

  it("bad input returns 400 with a structured error envelope", async () => {
    const res = await request(app).get("/v1/products/notaplatform/PID001").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "validation_error" });
  });
});

describe("errorHandler middleware — direct mapping of every error type (Phase 6 Step 2)", () => {
  function buildTestApp(thrown: unknown) {
    const testApp = express();
    testApp.get("/throw", (_req, _res, next) => next(thrown));
    testApp.use(errorHandler);
    return testApp;
  }

  it("ValidationError -> 400", async () => {
    const res = await request(buildTestApp(new ValidationError("bad input"))).get("/throw");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("UnauthorizedError -> 401", async () => {
    const res = await request(buildTestApp(new UnauthorizedError())).get("/throw");
    expect(res.status).toBe(401);
  });

  it("ForbiddenError -> 403", async () => {
    const res = await request(buildTestApp(new ForbiddenError())).get("/throw");
    expect(res.status).toBe(403);
  });

  it("NotFoundError -> 404", async () => {
    const res = await request(buildTestApp(new NotFoundError())).get("/throw");
    expect(res.status).toBe(404);
  });

  it("AiProviderError with category=provider_rate_limit -> 503, retryable/retryAfterMs passed through", async () => {
    const err = new AiProviderError("mock", "rate limited", { category: "provider_rate_limit", retryable: true, retryAfterMs: 5000 });
    const res = await request(buildTestApp(err)).get("/throw");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ai_provider_rate_limit");
    expect(res.body.error.retryable).toBe(true);
    expect(res.body.error.retryAfterMs).toBe(5000);
  });

  it("AiProviderError with category=provider_timeout -> 503", async () => {
    const err = new AiProviderError("mock", "timed out", { category: "provider_timeout" });
    const res = await request(buildTestApp(err)).get("/throw");
    expect(res.status).toBe(503);
  });

  it("AiProviderError with category=validation_error -> 502 (a provider/schema mismatch, not the caller's fault)", async () => {
    const err = new AiProviderError("mock", "schema mismatch", { category: "validation_error" });
    const res = await request(buildTestApp(err)).get("/throw");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("ai_validation_error");
  });

  it("a generic unexpected Error -> 500, message never leaked to the client", async () => {
    const res = await request(buildTestApp(new Error("some internal secret detail"))).get("/throw");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal_error");
    expect(JSON.stringify(res.body)).not.toContain("some internal secret detail");
  });
});
