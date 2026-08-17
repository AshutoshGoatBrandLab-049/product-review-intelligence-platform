import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { config } from "../../src/config/index.js";
import * as prodReadOnly from "../../src/database/prodReadOnly/index.js";

/**
 * Mandatory safety test #3 (corrected, Phase 1 final plan §J): proves
 * review_intel_ro-shaped grants actually reject writes — entirely against
 * LOCAL infrastructure. Production is never touched by this test, or by
 * anything else in this suite.
 */
describe("local read-only role rejects writes (mirrors review_intel_ro grants)", () => {
  const localRoPool = new Pool({
    host: config.prodReadOnly.host,
    port: config.prodReadOnly.port,
    database: config.prodReadOnly.database,
    user: config.prodReadOnly.user,
    password: config.prodReadOnly.password,
  });

  it("can SELECT from flipkart_reviews (via the real fixed-surface function)", async () => {
    const rows = await prodReadOnly.getFlipkartReviewsPage(0, 5);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("can SELECT from myntra_reviews (via the real fixed-surface function)", async () => {
    const rows = await prodReadOnly.getMyntraReviewsPage(0, 5);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("REJECTS an INSERT into flipkart_reviews", async () => {
    await expect(
      localRoPool.query(
        `INSERT INTO "DataWarehouse".flipkart_reviews (pid, review_id, rating, review_date) VALUES ('X','Y',5, CURRENT_DATE)`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("REJECTS an UPDATE against myntra_reviews", async () => {
    await expect(
      localRoPool.query(`UPDATE "DataWarehouse".myntra_reviews SET rating = 1`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("REJECTS a DELETE against flipkart_reviews", async () => {
    await expect(
      localRoPool.query(`DELETE FROM "DataWarehouse".flipkart_reviews`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("REJECTS a DDL statement (CREATE TABLE) in the DataWarehouse schema", async () => {
    await expect(
      localRoPool.query(`CREATE TABLE "DataWarehouse".should_not_exist (id INT)`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("REJECTS an attempted TRUNCATE", async () => {
    await expect(
      localRoPool.query(`TRUNCATE "DataWarehouse".flipkart_reviews`),
    ).rejects.toThrow(/permission denied/i);
  });
});
