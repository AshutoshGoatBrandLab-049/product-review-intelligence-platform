import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { IngestionReject } from "../../src/database/appStore/models/ingestionReject.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

describe("ingestion_rejects — invalid rows are quarantined, never silently dropped", () => {
  beforeEach(async () => {
    await resetAppStore();
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid = 'PID_BAD'`);
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "${config.appStore.schema}".flipkart_reviews WHERE pid = 'PID_BAD'`);
    await fixturePool.end();
  });

  it("rejects a row with an out-of-range rating and records only the allowlisted fields", async () => {
    await fixturePool.query(
      `INSERT INTO "${config.appStore.schema}".flipkart_reviews (pid, review_id, rating, review_date, country)
       VALUES ('PID_BAD', 'bad_rating_1', 9, CURRENT_DATE, 'India')`,
    );

    const result = await runTrackA("flipkart");
    expect(result.rowsRejected).toBeGreaterThanOrEqual(1);

    const reject = await IngestionReject.findOne({ where: { reason: "invalid_rating" } });
    expect(reject).not.toBeNull();
    expect(reject!.failedFields).toHaveProperty("rating", 9);
    expect(reject!.failedFields).not.toHaveProperty("reviewText");
    expect(reject!.failedFields).not.toHaveProperty("author");
  });
});
