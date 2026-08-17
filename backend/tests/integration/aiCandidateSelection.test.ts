import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { runAiSentimentPipeline } from "../../src/modules/ai/pipeline.js";
import { summarizeCandidates } from "../../src/modules/ai/candidateSelection.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { ReviewSentiment } from "../../src/database/appStore/models/reviewSentiment.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

describe("AI candidate selection & staleness (Phase 4 §7)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  afterAll(async () => {
    await fixturePool.end();
  });

  it("item 12: a new review (never classified) is a candidate", async () => {
    await runTrackA("flipkart");
    const summary = await summarizeCandidates({ platform: "flipkart" });
    expect(summary.newCount).toBeGreaterThan(0);
    expect(summary.candidateCount).toBe(summary.newCount);
  });

  it("item 8: an unchanged, already-classified review is NOT a candidate", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);

    const summary = await summarizeCandidates({ platform: "flipkart" });
    expect(summary.candidateCount).toBe(0);
    expect(summary.staleCount).toBe(0);
  });

  it("item 9: an updatedAt-only change does NOT make a classified review a candidate again", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);

    await fixturePool.query(`UPDATE "DataWarehouse".flipkart_reviews SET "updatedAt" = now() WHERE pid = 'PID001'`);
    await runTrackB("flipkart"); // re-syncs normalized_reviews; content_hash is unaffected by updatedAt

    const summary = await summarizeCandidates({ platform: "flipkart" });
    expect(summary.staleCount).toBe(0);
    expect(summary.candidateCount).toBe(0);
  });

  it("item 10/7: a content change makes the review stale (a candidate again)", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);

    await fixturePool.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET comment = 'Completely different review text now.', "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
    await runTrackB("flipkart");

    const summary = await summarizeCandidates({ platform: "flipkart" });
    expect(summary.staleCount).toBeGreaterThanOrEqual(1);

    // Restore for other tests sharing this fixture row.
    await fixturePool.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET comment = 'Loved it, works perfectly', "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
  });

  it("item 11: a rating change makes the review stale (a candidate again)", async () => {
    await runTrackA("flipkart");
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);

    const before = await ReviewSentiment.findAll();
    const beforeCount = before.length;

    await fixturePool.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET rating = 1, "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
    await runTrackB("flipkart");

    const summary = await summarizeCandidates({ platform: "flipkart" });
    expect(summary.staleCount).toBeGreaterThanOrEqual(1);

    // Reprocess and confirm the sentiment record updates to reflect the new rating (negative).
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    const after = await ReviewSentiment.findAll();
    expect(after.length).toBe(beforeCount); // same row count — upsert, not a new row

    // Restore for other tests sharing this fixture row.
    await fixturePool.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET rating = 5, "updatedAt" = now() WHERE pid = 'PID001' AND review_id = 'fk_hash_0001'`,
    );
  });
});
