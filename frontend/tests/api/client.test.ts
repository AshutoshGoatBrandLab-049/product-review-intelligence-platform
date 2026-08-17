import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet } from "@/api/client";
import { setAuthToken } from "@/api/authToken";
import { ApiClientError } from "@/api/errors";

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("apiGet (Phase 7 Step 1 — central API client)", () => {
  beforeEach(() => {
    setAuthToken(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches Authorization: Bearer <token> when a token is set", async () => {
    setAuthToken("test-token-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, { ok: true }));

    await apiGet("/v1/products/rankings");

    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-token-123" });
  });

  it("does not attach an Authorization header when no token is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, { ok: true }));
    await apiGet("/v1/products/rankings");
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
  });

  it("returns parsed JSON on a 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, { hello: "world" }));
    const result = await apiGet<{ hello: string }>("/v1/products/rankings");
    expect(result).toEqual({ hello: "world" });
  });

  it.each([
    [400, "validation"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "server"],
  ] as const)("normalizes a real %i response into ApiClientError kind %s", async (status, kind) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(status, { error: { code: "some_code", message: "failed" } }));
    await expect(apiGet("/v1/products/rankings")).rejects.toMatchObject(
      new ApiClientError(kind, "failed", { status, code: "some_code" }),
    );
  });

  it("normalizes an ai_* error code to kind ai_unavailable regardless of status, preserving retryable/retryAfterMs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(503, { error: { code: "ai_provider_rate_limit", message: "rate limited", retryable: true, retryAfterMs: 5000 } }),
    );
    try {
      await apiGet("/v1/products/flipkart/PID001/insights");
      throw new Error("expected apiGet to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      const apiErr = err as ApiClientError;
      expect(apiErr.kind).toBe("ai_unavailable");
      expect(apiErr.retryable).toBe(true);
      expect(apiErr.retryAfterMs).toBe(5000);
    }
  });

  it("normalizes a network failure (fetch itself throws) into kind 'network'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiGet("/v1/products/rankings")).rejects.toMatchObject({ kind: "network" });
  });

  it("never logs the token — no console output during a request", async () => {
    setAuthToken("super-secret-token");
    const logSpy = vi.spyOn(console, "log");
    const errorSpy = vi.spyOn(console, "error");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse(200, {}));

    await apiGet("/v1/products/rankings");

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
