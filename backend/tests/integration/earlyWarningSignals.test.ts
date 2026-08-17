import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { QueryTypes } from "sequelize";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { detectProductSignals, detectAllProductSignals, type SignalThresholds } from "../../src/modules/analytics/earlyWarning.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { config } from "../../src/config/index.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

// Phase 5 Step 7 — dedicated coverage for the deterministic early-warning
// rule engine (earlyWarning.ts): all 6 signal types (5 live + 1 confirmed
// not_ready), threshold overrides, evidence correctness, and the catalog-wide
// sweep. Isolated fixture DB only; zero real Gemini/Anthropic calls anywhere
// in this file — every signal here is pure arithmetic over inserted rows.

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
     VALUES ('EWBrand', $1, $2, $3, 't', 'c', CURRENT_DATE - $4::int, 'u', 'a', true, 0, 'India', now(), now())`,
    [pid, reviewId, rating, daysAgo],
  );
}

const DUMMY_HASH = "a".repeat(64);

/** Attaches one review_theme row (a "complaint mention" per earlyWarning.ts's
 * proxy) to a specific already-ingested review, looking up its real
 * canonical_review_id rather than computing the hash independently. */
async function insertThemeMention(pid: string, reviewId: string): Promise<void> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ canonical_review_id: string }>(
    `SELECT canonical_review_id FROM "${schema}".normalized_reviews
     WHERE platform = 'flipkart' AND source_product_id = :pid AND source_review_id = :reviewId`,
    { type: QueryTypes.SELECT, replacements: { pid, reviewId } },
  );
  if (!row) throw new Error(`insertThemeMention: no normalized_reviews row for ${pid}/${reviewId} — did Track A run first?`);
  await appSequelize.query(
    `INSERT INTO "${schema}".review_theme (canonical_review_id, theme, confidence, model_version, content_hash_at_extraction)
     VALUES (:canonicalReviewId, 'quality', 0.9, 'test-fixture-v1', :hash)`,
    { replacements: { canonicalReviewId: row.canonical_review_id, hash: DUMMY_HASH } },
  );
}

const WINDOW = resolveNamedWindow("30d");

const RATING_DECLINE_PID = "PHASE5EWRATINGDECLINE";
const NEGATIVE_INCREASE_PID = "PHASE5EWNEGINCREASE";
const VOLUME_SPIKE_PID = "PHASE5EWVOLUMESPIKE";
const COMPLAINT_SPIKE_PID = "PHASE5EWCOMPLAINTSPIKE";
const ALL_PIDS = [RATING_DECLINE_PID, NEGATIVE_INCREASE_PID, VOLUME_SPIKE_PID, COMPLAINT_SPIKE_PID];

describe("early warning signals (Phase 5 Step 7 — dedicated rule-engine coverage)", () => {
  beforeAll(async () => {
    // sudden_rating_decline / persistent_negative_trend: 5-star baseline, 1-star recent.
    for (let i = 0; i < 5; i++) await insertFlipkart(RATING_DECLINE_PID, `RD-PREV-${i}`, 5, 40);
    for (let i = 0; i < 5; i++) await insertFlipkart(RATING_DECLINE_PID, `RD-CURR-${i}`, 1, 5);

    // sudden_negative_review_increase: 20% negative baseline -> 100% negative recent.
    for (let i = 0; i < 4; i++) await insertFlipkart(NEGATIVE_INCREASE_PID, `NI-PREV-GOOD-${i}`, 4, 40);
    await insertFlipkart(NEGATIVE_INCREASE_PID, "NI-PREV-BAD-0", 1, 40);
    for (let i = 0; i < 5; i++) await insertFlipkart(NEGATIVE_INCREASE_PID, `NI-CURR-${i}`, 1, 5);

    // review_volume_spike in isolation: rating held constant at 5 on both sides.
    for (let i = 0; i < 3; i++) await insertFlipkart(VOLUME_SPIKE_PID, `VS-PREV-${i}`, 5, 40);
    for (let i = 0; i < 12; i++) await insertFlipkart(VOLUME_SPIKE_PID, `VS-CURR-${i}`, 5, 5);

    // complaint_spike in isolation: rating held constant at 1 on both sides
    // (so decline/negative-increase/volume-spike/trend all stay silent) —
    // only the theme-mention growth rate differs: 2 historical -> 6 recent.
    for (let i = 0; i < 5; i++) await insertFlipkart(COMPLAINT_SPIKE_PID, `CS-PREV-${i}`, 1, 40);
    for (let i = 0; i < 6; i++) await insertFlipkart(COMPLAINT_SPIKE_PID, `CS-CURR-${i}`, 1, 5);
  });

  beforeEach(async () => {
    await resetAppStore();
    await runTrackA("flipkart");
    await rebuildAnalytics();
    // Theme mentions must be inserted after Track A creates the normalized
    // rows they reference (canonical_review_id doesn't exist beforehand).
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-PREV-0");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-PREV-1");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-CURR-0");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-CURR-1");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-CURR-2");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-CURR-3");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-CURR-4");
    await insertThemeMention(COMPLAINT_SPIKE_PID, "CS-CURR-5");
  });

  afterAll(async () => {
    await fixturePool.query(`DELETE FROM "DataWarehouse".flipkart_reviews WHERE pid = ANY($1)`, [ALL_PIDS]);
    await fixturePool.end();
  });

  it("sudden_rating_decline fires using the configured default threshold, with exact evidence", async () => {
    const signals = await detectProductSignals("flipkart", RATING_DECLINE_PID, WINDOW);
    const decline = signals.find((s) => s.signalType === "sudden_rating_decline");
    expect(decline).toBeDefined();
    expect(decline?.threshold).toBe(config.earlyWarning.ratingDeclinePercent);
    expect(decline?.delta).toBeLessThanOrEqual(config.earlyWarning.ratingDeclinePercent);
    expect(decline?.evidenceReviewIds.length).toBe(5); // the 5 recent rating<=2 reviews, within WINDOW only
  });

  it("persistent_negative_trend fires alongside a declining trend and a higher recent negative rate", async () => {
    const signals = await detectProductSignals("flipkart", RATING_DECLINE_PID, WINDOW);
    const trend = signals.find((s) => s.signalType === "persistent_negative_trend");
    expect(trend).toBeDefined();
    expect(trend?.currentMetric).toBeGreaterThan(trend?.baselineMetric ?? 0);
  });

  it("sudden_negative_review_increase fires using the configured default threshold", async () => {
    const signals = await detectProductSignals("flipkart", NEGATIVE_INCREASE_PID, WINDOW);
    const increase = signals.find((s) => s.signalType === "sudden_negative_review_increase");
    expect(increase).toBeDefined();
    expect(increase?.threshold).toBe(config.earlyWarning.negativeReviewIncreasePercent);
    expect(increase?.delta).toBeGreaterThanOrEqual(config.earlyWarning.negativeReviewIncreasePercent);
    expect(increase?.currentMetric).toBe(100);
    expect(increase?.baselineMetric).toBe(20);
  });

  it("review_volume_spike fires in isolation (no rating movement) using the configured default threshold", async () => {
    const signals = await detectProductSignals("flipkart", VOLUME_SPIKE_PID, WINDOW);
    const spike = signals.find((s) => s.signalType === "review_volume_spike");
    expect(spike).toBeDefined();
    expect(spike?.threshold).toBe(config.earlyWarning.volumeSpikeMultiplier);
    expect(spike?.currentMetric).toBe(12);
    expect(spike?.baselineMetric).toBe(3);
    // Isolation check: rating-based signals must stay silent for this fixture.
    expect(signals.find((s) => s.signalType === "sudden_rating_decline")).toBeUndefined();
    expect(signals.find((s) => s.signalType === "sudden_negative_review_increase")).toBeUndefined();
  });

  it("complaint_spike fires for real (2 -> 6 theme mentions) using the configured default threshold, with exact evidence", async () => {
    const signals = await detectProductSignals("flipkart", COMPLAINT_SPIKE_PID, WINDOW);
    const complaintSpike = signals.find((s) => s.signalType === "complaint_spike");
    expect(complaintSpike).toBeDefined();
    expect(complaintSpike?.confidence).not.toBe("not_ready");
    expect(complaintSpike?.baselineMetric).toBe(2);
    expect(complaintSpike?.currentMetric).toBe(6);
    expect(complaintSpike?.delta).toBe(200); // (6-2)/2*100
    expect(complaintSpike?.threshold).toBe(config.earlyWarning.complaintSpikePercent);
    expect(complaintSpike?.evidenceReviewIds.length).toBe(6); // recent complaint-tagged reviews within WINDOW only
    // Isolation check: rating held constant at 1 throughout, so none of the
    // rating-driven signals should fire for this fixture.
    expect(signals.find((s) => s.signalType === "sudden_rating_decline")).toBeUndefined();
    expect(signals.find((s) => s.signalType === "sudden_negative_review_increase")).toBeUndefined();
    expect(signals.find((s) => s.signalType === "review_volume_spike")).toBeUndefined();
    expect(signals.find((s) => s.signalType === "persistent_negative_trend")).toBeUndefined();
  });

  it("complaint_spike respects an explicit threshold override, not just the config default", async () => {
    const looseThresholds: SignalThresholds = { ...config.earlyWarning, complaintSpikePercent: 50 };
    const strictThresholds: SignalThresholds = { ...config.earlyWarning, complaintSpikePercent: 500 };

    const looseSignals = await detectProductSignals("flipkart", COMPLAINT_SPIKE_PID, WINDOW, looseThresholds);
    expect(looseSignals.find((s) => s.signalType === "complaint_spike")).toBeDefined();

    const strictSignals = await detectProductSignals("flipkart", COMPLAINT_SPIKE_PID, WINDOW, strictThresholds);
    expect(strictSignals.find((s) => s.signalType === "complaint_spike")).toBeUndefined();
  });

  it("complaint_spike stays not_ready when no threshold is supplied at all (the pre-Step-4 default-preserving path)", async () => {
    const noComplaintThreshold: SignalThresholds = {
      ratingDeclinePercent: config.earlyWarning.ratingDeclinePercent,
      negativeReviewIncreasePercent: config.earlyWarning.negativeReviewIncreasePercent,
      volumeSpikeMultiplier: config.earlyWarning.volumeSpikeMultiplier,
      // complaintSpikePercent deliberately omitted
    };
    const signals = await detectProductSignals("flipkart", COMPLAINT_SPIKE_PID, WINDOW, noComplaintThreshold);
    const complaintSpike = signals.find((s) => s.signalType === "complaint_spike");
    expect(complaintSpike?.confidence).toBe("not_ready");
  });

  it("product_deterioration is always not_ready — no severity formula exists (Phase 5 descope, confirmed unchanged)", async () => {
    for (const pid of ALL_PIDS) {
      const signals = await detectProductSignals("flipkart", pid, WINDOW);
      const deterioration = signals.find((s) => s.signalType === "product_deterioration");
      expect(deterioration?.confidence).toBe("not_ready");
      expect(deterioration?.evidenceReviewIds).toEqual([]);
    }
  });

  it("explicit rating-decline threshold override changes firing behavior in both directions", async () => {
    const stricterThanActual: SignalThresholds = { ...config.earlyWarning, ratingDeclinePercent: -95 }; // actual delta is -80
    const looserThanActual: SignalThresholds = { ...config.earlyWarning, ratingDeclinePercent: -5 };

    const strictSignals = await detectProductSignals("flipkart", RATING_DECLINE_PID, WINDOW, stricterThanActual);
    expect(strictSignals.find((s) => s.signalType === "sudden_rating_decline")).toBeUndefined();

    const looseSignals = await detectProductSignals("flipkart", RATING_DECLINE_PID, WINDOW, looserThanActual);
    expect(looseSignals.find((s) => s.signalType === "sudden_rating_decline")).toBeDefined();
  });

  it("detectAllProductSignals sweeps the full catalog via keyset pagination (small batch size forces multiple pages)", async () => {
    const result = await detectAllProductSignals(WINDOW, config.earlyWarning, 2 /* batchSize < number of fixture products */);
    // The isolated fixture DB also carries a shared baseline seed (PID001/
    // PID002) used by other test files, so a sweep here scans at least our 4
    // fixture products, not exactly 4 — exact equality would be brittle
    // against that shared fixture rather than proving anything about our own.
    expect(result.productsScanned).toBeGreaterThanOrEqual(ALL_PIDS.length);

    const scannedPids = new Set(result.signals.map((s) => s.sourceProductId));
    for (const pid of ALL_PIDS) expect(scannedPids.has(pid)).toBe(true);

    // At least one instance of each of the 5 "live" signal types should
    // appear somewhere across the full sweep, given the fixture design above.
    const firedTypes = new Set(result.signals.map((s) => s.signalType));
    expect(firedTypes.has("sudden_rating_decline")).toBe(true);
    expect(firedTypes.has("sudden_negative_review_increase")).toBe(true);
    expect(firedTypes.has("review_volume_spike")).toBe(true);
    expect(firedTypes.has("persistent_negative_trend")).toBe(true);
    expect(firedTypes.has("complaint_spike")).toBe(true);
    // product_deterioration always appears too (not_ready, once per product
    // scanned — including the shared baseline seed, so >= our own 4, not ==).
    expect(result.signals.filter((s) => s.signalType === "product_deterioration").length).toBeGreaterThanOrEqual(ALL_PIDS.length);
  });
});
