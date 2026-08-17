/**
 * Phase 7 Step 1 — the ONLY module that holds the current auth token in
 * memory. AuthProvider writes to it; the API client reads from it. No
 * component ever constructs an Authorization header itself.
 *
 * Deliberately in-memory, not localStorage/sessionStorage: this is a
 * development-only token (VITE_DEV_TOKEN, no login flow exists — Phase 6
 * has no login endpoint), so there's nothing to "remember" across a real
 * session in the way a production app would need; keeping it out of any
 * persistent browser storage is a cheap, disclosed-in-the-design-doc
 * precaution against a bad pattern getting copy-pasted into a future
 * production build.
 */
let currentToken: string | undefined;

export function setAuthToken(token: string | undefined): void {
  currentToken = token;
}

export function getAuthToken(): string | undefined {
  return currentToken;
}
