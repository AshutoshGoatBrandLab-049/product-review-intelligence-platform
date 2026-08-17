import { describe, it, expect } from "vitest";
import { assertLocalMigrationTarget } from "../../src/config/assertLocalMigrationTarget.js";

describe("assertLocalMigrationTarget", () => {
  it("allows localhost", () => {
    expect(() => assertLocalMigrationTarget("localhost")).not.toThrow();
  });

  it("allows 127.0.0.1", () => {
    expect(() => assertLocalMigrationTarget("127.0.0.1")).not.toThrow();
  });

  it("allows ::1", () => {
    expect(() => assertLocalMigrationTarget("::1")).not.toThrow();
  });

  it("rejects a non-local host", () => {
    expect(() => assertLocalMigrationTarget("prod-rds.amazonaws.com")).toThrow(
      /Refusing to migrate/,
    );
  });

  it("rejects the actual production RDS-shaped host", () => {
    expect(() => assertLocalMigrationTarget("gbl-data-lake.rds.amazonaws.com")).toThrow(
      /Refusing to migrate/,
    );
  });

  it("has no override parameter — passing extra arguments cannot bypass the refusal", () => {
    // There is deliberately no second parameter on this function anymore
    // (Phase 1.5 removed ALLOW_REMOTE_APP_MIGRATIONS). Calling it with an
    // extra truthy-looking argument, as old caller code might, must still
    // reject a non-local host — TypeScript blocks this call shape entirely,
    // but this test proves the *runtime* behavior can't be tricked by a
    // caller that ignores type errors (e.g. plain JS, or `as any`).
    const bypassAttempt = assertLocalMigrationTarget as (
      host: string,
      ...extra: unknown[]
    ) => void;
    expect(() => bypassAttempt("prod-rds.amazonaws.com", true)).toThrow(/Refusing to migrate/);
  });

  it("cannot be bypassed via an ALLOW_REMOTE_APP_MIGRATIONS environment variable", () => {
    // The config layer no longer parses this variable at all — setting it
    // must have zero effect on assertLocalMigrationTarget's behavior.
    const original = process.env.ALLOW_REMOTE_APP_MIGRATIONS;
    process.env.ALLOW_REMOTE_APP_MIGRATIONS = "true";
    try {
      expect(() => assertLocalMigrationTarget("prod-rds.amazonaws.com")).toThrow(
        /Refusing to migrate/,
      );
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_REMOTE_APP_MIGRATIONS;
      } else {
        process.env.ALLOW_REMOTE_APP_MIGRATIONS = original;
      }
    }
  });
});
