import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { findEvidence } from "../../src/modules/analytics/evidence.js";
import { detectProductSignals } from "../../src/modules/analytics/earlyWarning.js";
import { computeDataQualityReport } from "../../src/modules/analytics/dataQuality.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const fixturePool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: "postgres",
  password: "1234",
});

async function insertFlipkart(pid: string, reviewId: string, rating: number, daysAgo: number): Promise<void> {
  await fixturePool.query(
    `INSERT INTO "DataWarehouse".flipkart_reviews
       (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
     VALUES ('B', $1, $2, $3, 't', 'c', CURRENT_DATE - $4::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [pid, reviewId, rating, daysAgo],
  );
}

const WINDOW = resolveNamedWindow("30d");

describe("evidence, early warning, data quality (Phase 3 §16, §15, §20)", () => {
  const evidencePid = "PHASE3EVIDENCEPID";
  const warningPid = "PHASE3WARNINGPID";
  const malformedPid = "PHASE3DQMALFORMED";

  beforeAll(async () => {
    // Evidence: 3 negative reviews within window.
    for (let i = 0; i < 3; i++) await insertFlipkart(evidencePid, `EVID-${i}`, 1, 5);

    // Early warning: sharp rating decline + volume spike.
    for (let i = 0; i < 6; i++) await insertFlipkart(warningPid, `WARN-PREV-${i}`, 5, 40);
    for (let i = 0; i < 20; i++) await insertFlipkart(warningPid, `WARN-CURR-${i}`, 1, 5);

    // Data quality: one malformed row (invalid rating) for reject-reporting.
    await fixturePool.query(
      `INSERT INTO "DataWarehouse".flipkart_reviews
         (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
       VALUES ('B', $1, 'DQ-MALFORMED-1', 0, 't', 'c', CURRENT_DATE - 3, 'u', 'a', true, 0, 'India', now(), now())`,
      [malformedPid],
    );
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await rebuildAnalytics();
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "DataWarehouse".flipkart_reviews WHERE pid IN ($1, $2, $3)`, [evidencePid, warningPid, malformedPid]);
    await fixturePool.end();
  });

  it("evidence references: bounded canonicalReviewIds with an accurate totalMatchingCount", async () => {
    const evidence = await findEvidence({
      platform: "flipkart",
      sourceProductId: evidencePid,
      window: WINDOW,
      description: "rating <= 2",
      ratingIn: [1, 2],
    });
    expect(evidence.totalMatchingCount).toBe(3);
    expect(evidence.canonicalReviewIds.length).toBe(3); // under the 20-item cap, so all are returned
    expect(evidence.canonicalReviewIds.length).toBeLessThanOrEqual(20);
  });

  it("early-warning signals: sudden_rating_decline and review_volume_spike fire with correct evidence and thresholds", async () => {
    const signals = await detectProductSignals("flipkart", warningPid, WINDOW);
    const decline = signals.find((s) => s.signalType === "sudden_rating_decline");
    const spike = signals.find((s) => s.signalType === "review_volume_spike");

    expect(decline).toBeDefined();
    expect(decline!.delta).toBeLessThanOrEqual(decline!.threshold);
    expect(decline!.evidenceReviewIds.length).toBeGreaterThan(0);

    expect(spike).toBeDefined();
    expect(spike!.currentMetric).toBeGreaterThanOrEqual(spike!.baselineMetric * 2);
  });

  it("early-warning signals: product_deterioration remains not_ready (no severity formula exists) — never fabricated", async () => {
    const signals = await detectProductSignals("flipkart", warningPid, WINDOW);
    const deterioration = signals.find((s) => s.signalType === "product_deterioration");
    expect(deterioration?.confidence).toBe("not_ready");
  });

  // Phase 5 Step 4 — complaint_spike now has a real, data-derived default
  // threshold (config.earlyWarning.complaintSpikePercent), so it's no longer
  // unconditionally "not_ready": it runs the real computation and behaves
  // like the other 4 working signals — present only when it actually fires.
  // This fixture has zero review_theme data (Track A never runs AI
  // classification), so both windows' complaint-mention counts are 0,
  // producing a defined-but-zero growth rate that never clears any positive
  // threshold — correctly absent from the result, not fabricated as "ready."
  it("early-warning signals: complaint_spike with a real threshold and zero complaint data correctly does not fire (absent, not fabricated)", async () => {
    const signals = await detectProductSignals("flipkart", warningPid, WINDOW);
    const complaintSpike = signals.find((s) => s.signalType === "complaint_spike");
    expect(complaintSpike).toBeUndefined();
  });

  it("early-warning signals: complaint_spike explicitly reverts to not_ready when no threshold is supplied (the pre-Step-4 default-preserving path)", async () => {
    const signals = await detectProductSignals("flipkart", warningPid, WINDOW, {
      ratingDeclinePercent: -15,
      negativeReviewIncreasePercent: 20,
      volumeSpikeMultiplier: 2,
      // complaintSpikePercent deliberately omitted
    });
    const complaintSpike = signals.find((s) => s.signalType === "complaint_spike");
    expect(complaintSpike?.confidence).toBe("not_ready");
  });

  it("data-quality report: surfaces reject reasons without silently excluding raw counts", async () => {
    const { rows } = await fixturePool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "DataWarehouse".flipkart_reviews`);
    const sourceTotal = Number(rows[0]!.count);

    const report = await computeDataQualityReport("flipkart", WINDOW, sourceTotal);
    expect(report.completeness.missing).toBe(0);
    const invalidRatingReject = report.rejectsByReason.find((r) => r.reason === "invalid_rating");
    expect(invalidRatingReject).toBeDefined();
    expect(invalidRatingReject!.count).toBeGreaterThanOrEqual(1);
  });

  it("data-quality report: flags low-sample products without dropping them", async () => {
    const { rows } = await fixturePool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "DataWarehouse".flipkart_reviews`);
    const sourceTotal = Number(rows[0]!.count);
    const report = await computeDataQualityReport("flipkart", WINDOW, sourceTotal);
    expect(report.lowSampleProducts).toBeGreaterThanOrEqual(1);
  });
});
