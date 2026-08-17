import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./tests/setupTestEnv.ts"],
    // Integration/security tests share one real local database with mutable
    // state (truncates, inserts against the fixture tables) — running test
    // files in parallel races them against each other. Unit tests don't
    // need this, but running everything sequentially is simple, correct,
    // and Phase 1's suite is small enough that it costs little.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
    testTimeout: 20000,
  },
});
