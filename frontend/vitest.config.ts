import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setupTests.ts"],
    /**
     * tests/e2e/ holds PLAYWRIGHT specs — run them with `npx playwright test`.
     *
     * Without this exclusion vitest picks them up and every one fails to load
     * with "Playwright Test did not expect test.describe() to be called here",
     * which is a harness mismatch rather than a real failure. Leaving it in place
     * buries genuine regressions in a wall of red.
     */
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/e2e/**",
    ],
    /**
     * src/__tests__/pagination-browser.test.ts launches a REAL Chrome via
     * puppeteer and drives it against the running dev server. Sharing a machine
     * with 22 other files running in parallel made it fail intermittently
     * (336/336, then 335/336, then 334/336 across consecutive runs) — a resource
     * race, not a product defect. Raising its timeouts made it worse, because a
     * slower browser test holds contended resources for longer.
     *
     * The backend config already runs sequentially for the analogous reason
     * (shared mutable state). Same trade here: a slower suite that tells the
     * truth beats a fast one that cries wolf.
     */
    fileParallelism: false,
  },
});
