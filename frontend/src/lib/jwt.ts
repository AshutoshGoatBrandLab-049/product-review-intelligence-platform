/**
 * Phase 7 Step 1 — decodes a JWT's payload for DISPLAY PURPOSES ONLY.
 * Never verifies the signature (the frontend has no way to, and must
 * not — it never has JWT_SECRET). This is purely so the UI can show a
 * role-aware nav; the backend's own `authorize()` middleware is the only
 * real enforcement (Phase 6 §18) and re-validates the signature on every
 * request regardless of what this function returns.
 */
export interface DecodedTokenPayload {
  sub?: string;
  role?: string;
  exp?: number;
}

export function decodeJwtPayload(token: string): DecodedTokenPayload | null {
  try {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) return null;
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = atob(padded);
    return JSON.parse(json) as DecodedTokenPayload;
  } catch {
    return null; // malformed token — never throw, callers treat this as "no usable claims"
  }
}

export function isTokenExpired(payload: DecodedTokenPayload | null): boolean {
  if (!payload?.exp) return false; // no exp claim -> can't determine, don't assume expired
  return payload.exp * 1000 <= Date.now();
}
