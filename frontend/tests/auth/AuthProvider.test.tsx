import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

function fakeJwt(payload: object): string {
  const base64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.sig`;
}

/**
 * Each test stubs VITE_DEV_TOKEN and re-imports the module graph fresh
 * (config/env.ts reads import.meta.env once, at module load) — this is
 * what actually exercises the real "is a dev token configured" logic,
 * not a mocked stand-in for it.
 */
async function renderWithToken(token: string | undefined) {
  vi.resetModules();
  vi.stubEnv("VITE_DEV_TOKEN", token ?? "");
  const { AuthProvider, useAuth } = await import("@/providers/AuthProvider");

  function Probe() {
    const { isConfigured, role, subject } = useAuth();
    return <div data-testid="probe">{JSON.stringify({ isConfigured, role, subject })}</div>;
  }

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  return JSON.parse(screen.getByTestId("probe").textContent!) as { isConfigured: boolean; role: string | null; subject: string | null };
}

describe("AuthProvider (Phase 7 Step 1, §10 — dev-token-only auth foundation)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is not configured when VITE_DEV_TOKEN is absent", async () => {
    const state = await renderWithToken(undefined);
    expect(state).toEqual({ isConfigured: false, role: null, subject: null });
  });

  it("is not configured for a malformed token", async () => {
    const state = await renderWithToken("not-a-real-jwt");
    expect(state.isConfigured).toBe(false);
  });

  it("is not configured for an expired token", async () => {
    const token = fakeJwt({ sub: "test", role: "viewer", exp: Math.floor(Date.now() / 1000) - 60 });
    const state = await renderWithToken(token);
    expect(state.isConfigured).toBe(false);
  });

  it("is not configured for a token with an unrecognized role", async () => {
    const token = fakeJwt({ sub: "test", role: "superuser", exp: Math.floor(Date.now() / 1000) + 3600 });
    const state = await renderWithToken(token);
    expect(state.isConfigured).toBe(false);
  });

  it("is configured and exposes role=admin for a real, valid admin token", async () => {
    const token = fakeJwt({ sub: "test-admin", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 });
    const state = await renderWithToken(token);
    expect(state).toEqual({ isConfigured: true, role: "admin", subject: "test-admin" });
  });

  it("is configured and exposes role=viewer for a real, valid viewer token", async () => {
    const token = fakeJwt({ sub: "test-viewer", role: "viewer", exp: Math.floor(Date.now() / 1000) + 3600 });
    const state = await renderWithToken(token);
    expect(state.role).toBe("viewer");
  });
});
