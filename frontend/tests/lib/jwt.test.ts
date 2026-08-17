import { describe, it, expect } from "vitest";
import { decodeJwtPayload, isTokenExpired } from "@/lib/jwt";

function fakeJwt(payload: object): string {
  const base64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.fakesignature`;
}

describe("decodeJwtPayload (display-only decoding, Phase 7 Step 1)", () => {
  it("decodes a real, well-formed token's payload", () => {
    const token = fakeJwt({ sub: "test-viewer", role: "viewer", exp: 9999999999 });
    expect(decodeJwtPayload(token)).toEqual({ sub: "test-viewer", role: "viewer", exp: 9999999999 });
  });

  it("returns null for a malformed token rather than throwing", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload("a.b")).toBeNull();
  });
});

describe("isTokenExpired", () => {
  it("returns true for a real past exp", () => {
    expect(isTokenExpired({ exp: Math.floor(Date.now() / 1000) - 60 })).toBe(true);
  });

  it("returns false for a real future exp", () => {
    expect(isTokenExpired({ exp: Math.floor(Date.now() / 1000) + 3600 })).toBe(false);
  });

  it("returns false (not assumed expired) when there is no exp claim at all", () => {
    expect(isTokenExpired({})).toBe(false);
    expect(isTokenExpired(null)).toBe(false);
  });
});
