/**
 * Phase 7 Step 1 — the single place that reads import.meta.env. Nothing
 * else in this app touches `import.meta.env` directly, so an env change
 * (e.g. a future real API_BASE_URL) never means hunting through components.
 *
 * SECURITY: only VITE_-prefixed variables are ever bundled into client code
 * by Vite — this is a hard platform guarantee, not a convention this file
 * enforces. Nothing resembling JWT_SECRET, database credentials, or AI
 * provider keys is ever read here or exists in any .env file this app
 * loads — those stay backend-only, in backend/.env, never mirrored here.
 */

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

/**
 * Development-only stand-in for a real identity provider (Phase 6 has no
 * login endpoint — backend/scripts/issueDevToken.ts is a CLI tool, not an
 * HTTP route). Deliberately optional: its absence is a valid, expected
 * state handled by the auth provider (a dev-auth-required screen), not a
 * thrown error at module load.
 */
const devToken = import.meta.env.VITE_DEV_TOKEN as string | undefined;

export const env = {
  apiBaseUrl: apiBaseUrl && apiBaseUrl.length > 0 ? apiBaseUrl : "http://localhost:4000",
  devToken: devToken && devToken.length > 0 ? devToken : undefined,
  isDev: import.meta.env.DEV,
};
