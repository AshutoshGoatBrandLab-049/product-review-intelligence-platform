import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { computeCompletenessAudit } from "../../src/modules/ingestion/shared/completenessAudit.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

/**
 * Phase 2.1 §3 — proves the fixed completeness accounting rule holds even
 * under the exact conditions that made it go negative in Phase 2 (§9b/§19):
 * repeated Track B passes over a persistently-invalid row.
 */
describe("completeness audit (Phase 2.1 §3)", () => {
  const pid = "COMPLETENESS_AUDIT_PID";
  let insertedIds: number[] = [];

  beforeEach(async () => {
    await resetAppStore();
    insertedIds = [];

    const valid = [
      ["R-VALID-1", 5],
      ["R-VALID-2", 4],
      ["R-VALID-3", 3],
    ] as const;
    for (const [reviewId, rating] of valid) {
      const { rows } = await fixturePool.query<{ id: number }>(
        `INSERT INTO "DataWarehouse".flipkart_reviews
           (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
         VALUES ('B', $1, $2, $3, 't', 'c', CURRENT_DATE, 'u', 'a', true, 0, 'India', now(), now())
         RETURNING id`,
        [pid, reviewId, rating],
      );
      insertedIds.push(rows[0]!.id);
    }

    // One persistently-invalid row — this is the exact shape that caused the
    // negative "missing" count in Phase 2.
    const { rows: invalidRow } = await fixturePool.query<{ id: number }>(
      `INSERT INTO "DataWarehouse".flipkart_reviews
         (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
       VALUES ('B', $1, 'R-INVALID-1', 0, 't', 'c', CURRENT_DATE, 'u', 'a', true, 0, 'India', now(), now())
       RETURNING id`,
      [pid],
    );
    insertedIds.push(invalidRow[0]!.id);
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "DataWarehouse".flipkart_reviews WHERE pid = $1`, [pid]);
    await fixturePool.end();
  });

  it("stays exactly accounted-for (never negative) after 10 repeated Track B passes over a persistently-invalid row", async () => {
    for (let i = 0; i < 10; i++) {
      await runTrackB("flipkart");
    }

    // Total source rows currently in the (shared) isolated fixture table —
    // not just the ones this test added, since other fixture rows exist too
    // and Track B processes all of them within its window regardless.
    const { rows: totalRows } = await fixturePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "DataWarehouse".flipkart_reviews`,
    );
    const sourceTotal = Number(totalRows[0]!.count);

    const audit = await computeCompletenessAudit("flipkart", sourceTotal);

    expect(audit.distinctRejected).toBe(1); // one distinct invalid source row, not 10
    expect(audit.accountedFor).toBe(sourceTotal);
    expect(audit.missing).toBe(0); // never negative, regardless of 10 repeated passes
  });
});
