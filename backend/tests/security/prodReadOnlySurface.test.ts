import { describe, it, expect } from "vitest";
import * as prodReadOnly from "../../src/database/prodReadOnly/index.js";

/**
 * Source-table write protection has FOUR layers. This file is layer 2.
 *
 *   1. database role  — REMOVED, and deliberately not replaceable.
 *   2. module surface — this file: exactly four SELECT functions, no generic executor.
 *   3. static scan    — checkNoWrites.test.ts greps database/prodReadOnly/ for
 *                       INSERT / DELETE / DROP, proven against broken fixtures.
 *   4. startup assert — runStartupSafetyChecks() validates the config and the
 *                       two-table allowlist, refusing to boot on drift.
 *
 * Layer 1 was a separate read-only Postgres role (review_intel_ro) reached over a
 * second connection. It cannot exist under the current architecture: source tables
 * (flipkart_reviews, myntra_reviews) and canonical tables (normalized_reviews,
 * product_dimension, product_daily_metrics, …) live in the SAME database and the
 * SAME schema, and ingestion must write the canonical ones. A role that could not
 * write that schema would break ingestion outright, so read-only access is not a
 * property the database layer can express here.
 *
 * tests/security/localRoleWriteRejection.test.ts asserted layer 1 and was removed
 * for that reason — not because it was inconvenient. Do not reintroduce it without
 * first splitting source and canonical tables into separate schemas or databases.
 */
describe("prodReadOnly module surface — structural safety guarantee", () => {
  it("exports exactly the four approved functions, nothing else", () => {
    const exportedNames = Object.keys(prodReadOnly).sort();
    expect(exportedNames).toEqual(
      [
        "getFlipkartReviewsByDateWindow",
        "getFlipkartReviewsPage",
        "getMyntraReviewsByDateWindow",
        "getMyntraReviewsPage",
      ].sort(),
    );
  });

  it("exposes no generic query executor", () => {
    const exported = prodReadOnly as Record<string, unknown>;
    expect(exported.query).toBeUndefined();
    expect(exported.execute).toBeUndefined();
    expect(exported.runQuery).toBeUndefined();
    expect(exported.sequelize).toBeUndefined();
  });
});
