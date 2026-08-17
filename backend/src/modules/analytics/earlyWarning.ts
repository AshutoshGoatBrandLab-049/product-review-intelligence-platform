import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeProductAnalytics } from "./productAnalytics.js";
import { findEvidence } from "./evidence.js";
import { previousEquivalentWindow, type DateWindow } from "./dateWindows.js";
import type { ConfidenceLevel } from "./confidence.js";
import type { Platform } from "../../types/unifiedReview.js";

export type SignalType =
  | "sudden_rating_decline"
  | "sudden_negative_review_increase"
  | "complaint_spike"
  | "review_volume_spike"
  | "persistent_negative_trend"
  | "product_deterioration";

/**
 * The threshold values detectProductSignals's implemented signals use.
 * complaintSpikePercent is OPTIONAL and deliberately has no default anywhere
 * in this codebase yet (Phase 5 Step 1/2) — when it's undefined, complaint_spike
 * stays exactly the "not_ready" placeholder it always was; only when a real
 * value is explicitly supplied does the real computation run. Step 4 will give
 * it a real, data-derived default.
 */
export interface SignalThresholds {
  ratingDeclinePercent: number;
  negativeReviewIncreasePercent: number;
  volumeSpikeMultiplier: number;
  complaintSpikePercent?: number;
}

/** Same evidence cap used by evidence.ts's findEvidence — kept local since
 * findEvidence's own EvidenceQuery shape doesn't support the theme+sentiment
 * join complaint_spike needs, and extending that shared Phase 3 function
 * would risk changing behavior for its other, unrelated callers. */
const COMPLAINT_EVIDENCE_CAP = 20;

/**
 * Phase 5 Step 2 — count of theme mentions on "complaint-flagged" reviews
 * (rating<=2 OR sentiment=negative) within a window. review_theme itself has
 * no is_complaint/severity column (the original architecture's review_themes
 * junction assumed one; the table actually built in Phase 3/4 doesn't have
 * it) — this rating/sentiment join is the deterministic proxy used instead,
 * not a schema change to Phase 3/4's tables.
 */
export async function countComplaintThemeMentions(platform: Platform, sourceProductId: string, window: DateWindow): Promise<number> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM "${schema}".review_theme rt
     JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rt.canonical_review_id
     LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = rt.canonical_review_id
     WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
       AND nr.review_date >= :start AND nr.review_date <= :end
       AND (nr.rating <= 2 OR rs.label = 'negative')`,
    { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end } },
  );
  return Number(row?.count ?? 0);
}

async function findComplaintEvidence(platform: Platform, sourceProductId: string, window: DateWindow): Promise<string[]> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<{ canonical_review_id: string }>(
    `SELECT DISTINCT nr.canonical_review_id, nr.review_date
     FROM "${schema}".review_theme rt
     JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rt.canonical_review_id
     LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = rt.canonical_review_id
     WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
       AND nr.review_date >= :start AND nr.review_date <= :end
       AND (nr.rating <= 2 OR rs.label = 'negative')
     ORDER BY nr.review_date DESC
     LIMIT :cap`,
    { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end, cap: COMPLAINT_EVIDENCE_CAP } },
  );
  return rows.map((r) => r.canonical_review_id);
}

/**
 * Phase 5 Step 1 — externalized to config.earlyWarning (env-configurable, Zod
 * validated), so this is now a read-only alias for the effective configured
 * values, not a second, independently-hardcoded source of truth. Values are
 * IDENTICAL to what was previously hardcoded here unless someone deliberately
 * overrides via env — same pattern as CONFIDENCE_THRESHOLDS/TREND_THRESHOLDS.
 */
export const SIGNAL_THRESHOLDS: SignalThresholds = {
  ratingDeclinePercent: config.earlyWarning.ratingDeclinePercent,
  negativeReviewIncreasePercent: config.earlyWarning.negativeReviewIncreasePercent,
  volumeSpikeMultiplier: config.earlyWarning.volumeSpikeMultiplier,
};

export interface EarlyWarningSignal {
  signalType: SignalType;
  detectedDate: string;
  platform: Platform;
  sourceProductId: string;
  currentMetric: number;
  baselineMetric: number;
  delta: number;
  threshold: number;
  evidenceReviewIds: string[];
  confidence: ConfidenceLevel | "not_ready";
}

/**
 * Phase 3 §15 — deterministic signal detection only, no delivery mechanism.
 * `complaint_spike` and `product_deterioration` require theme/severity data
 * that doesn't exist until Phase 4+ (review_theme is an empty foundation
 * table in Phase 3) — they always return `confidence: "not_ready"` rather
 * than being fabricated from unrelated inputs.
 */
export async function detectProductSignals(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
  thresholds: SignalThresholds = config.earlyWarning,
): Promise<EarlyWarningSignal[]> {
  const analytics = await computeProductAnalytics(platform, sourceProductId, window);
  const { recentMetrics, historicalMetrics, ratingComparison } = analytics;
  const signals: EarlyWarningSignal[] = [];

  const bothConfident = recentMetrics.confidence !== "insufficient_data" && historicalMetrics.confidence !== "insufficient_data";
  const confidence = bothConfident ? recentMetrics.confidence : "insufficient_data";

  const evidenceBase = { platform, sourceProductId, window };

  // sudden_rating_decline
  if (bothConfident && ratingComparison.percentageDelta !== null && ratingComparison.percentageDelta <= thresholds.ratingDeclinePercent) {
    const evidence = await findEvidence({ ...evidenceBase, description: "rating <= 2 within window", ratingIn: [1, 2] });
    signals.push({
      signalType: "sudden_rating_decline",
      detectedDate: window.end,
      platform,
      sourceProductId,
      currentMetric: recentMetrics.averageRating ?? 0,
      baselineMetric: historicalMetrics.averageRating ?? 0,
      delta: ratingComparison.percentageDelta,
      threshold: thresholds.ratingDeclinePercent,
      evidenceReviewIds: evidence.canonicalReviewIds,
      confidence,
    });
  }

  // sudden_negative_review_increase
  if (bothConfident && recentMetrics.negativePercentage !== null && historicalMetrics.negativePercentage !== null) {
    const negComparison =
      historicalMetrics.negativePercentage === 0
        ? recentMetrics.negativePercentage > 0
          ? null
          : 0
        : ((recentMetrics.negativePercentage - historicalMetrics.negativePercentage) / historicalMetrics.negativePercentage) * 100;
    if (negComparison !== null && negComparison >= thresholds.negativeReviewIncreasePercent) {
      const evidence = await findEvidence({ ...evidenceBase, description: "rating <= 2 within window", ratingIn: [1, 2] });
      signals.push({
        signalType: "sudden_negative_review_increase",
        detectedDate: window.end,
        platform,
        sourceProductId,
        currentMetric: recentMetrics.negativePercentage,
        baselineMetric: historicalMetrics.negativePercentage,
        delta: negComparison,
        threshold: thresholds.negativeReviewIncreasePercent,
        evidenceReviewIds: evidence.canonicalReviewIds,
        confidence,
      });
    }
  }

  // review_volume_spike
  if (historicalMetrics.totalReviews > 0 && recentMetrics.totalReviews >= historicalMetrics.totalReviews * thresholds.volumeSpikeMultiplier) {
    const evidence = await findEvidence({ ...evidenceBase, description: "all reviews within window" });
    signals.push({
      signalType: "review_volume_spike",
      detectedDate: window.end,
      platform,
      sourceProductId,
      currentMetric: recentMetrics.totalReviews,
      baselineMetric: historicalMetrics.totalReviews,
      delta: recentMetrics.totalReviews - historicalMetrics.totalReviews,
      threshold: thresholds.volumeSpikeMultiplier,
      evidenceReviewIds: evidence.canonicalReviewIds,
      confidence: bothConfident ? recentMetrics.confidence : "insufficient_data",
    });
  }

  // persistent_negative_trend — deterministic proxy: trend already classified
  // "declining" AND current negative rate exceeds the historical one.
  if (
    bothConfident &&
    analytics.trendDirection === "declining" &&
    recentMetrics.negativePercentage !== null &&
    historicalMetrics.negativePercentage !== null &&
    recentMetrics.negativePercentage > historicalMetrics.negativePercentage
  ) {
    const evidence = await findEvidence({ ...evidenceBase, description: "rating <= 2 within window", ratingIn: [1, 2] });
    signals.push({
      signalType: "persistent_negative_trend",
      detectedDate: window.end,
      platform,
      sourceProductId,
      currentMetric: recentMetrics.negativePercentage,
      baselineMetric: historicalMetrics.negativePercentage,
      delta: recentMetrics.negativePercentage - historicalMetrics.negativePercentage,
      threshold: 0,
      evidenceReviewIds: evidence.canonicalReviewIds,
      confidence,
    });
  }

  // complaint_spike — Phase 5 Step 2. No default threshold exists anywhere yet
  // (Step 1/4) — when the caller hasn't explicitly supplied one, this stays
  // exactly the "not_ready" placeholder it always was; no behavior change for
  // any existing caller relying on the default. Only when a real threshold is
  // explicitly passed does the real complaint-mention growth-rate computation run.
  if (thresholds.complaintSpikePercent === undefined) {
    signals.push({
      signalType: "complaint_spike",
      detectedDate: window.end,
      platform,
      sourceProductId,
      currentMetric: 0,
      baselineMetric: 0,
      delta: 0,
      threshold: 0,
      evidenceReviewIds: [],
      confidence: "not_ready",
    });
  } else {
    const previousWindow = previousEquivalentWindow(window);
    const [recentComplaintCount, historicalComplaintCount] = await Promise.all([
      countComplaintThemeMentions(platform, sourceProductId, window),
      countComplaintThemeMentions(platform, sourceProductId, previousWindow),
    ]);
    const complaintComparison =
      historicalComplaintCount === 0
        ? recentComplaintCount > 0
          ? null
          : 0
        : ((recentComplaintCount - historicalComplaintCount) / historicalComplaintCount) * 100;
    if (bothConfident && complaintComparison !== null && complaintComparison >= thresholds.complaintSpikePercent) {
      const evidenceReviewIds = await findComplaintEvidence(platform, sourceProductId, window);
      signals.push({
        signalType: "complaint_spike",
        detectedDate: window.end,
        platform,
        sourceProductId,
        currentMetric: recentComplaintCount,
        baselineMetric: historicalComplaintCount,
        delta: complaintComparison,
        threshold: thresholds.complaintSpikePercent,
        evidenceReviewIds,
        confidence,
      });
    }
  }

  // product_deterioration — depends on a severity formula that doesn't exist
  // (severity.ts has type definitions only, no logic, through Phase 3/4) —
  // stays unconditionally not_ready, exactly as before. Descoped from Phase 5
  // per explicit instruction: no severity formula is invented here.
  signals.push({
    signalType: "product_deterioration",
    detectedDate: window.end,
    platform,
    sourceProductId,
    currentMetric: 0,
    baselineMetric: 0,
    delta: 0,
    threshold: 0,
    evidenceReviewIds: [],
    confidence: "not_ready",
  });

  return signals;
}

export interface CatalogSignalSweepResult {
  signals: EarlyWarningSignal[];
  productsScanned: number;
}

/**
 * Phase 5 Step 3 — catalog-wide sweep, calling detectProductSignals per
 * product rather than duplicating any of its logic. Keyset-paginated over
 * product_dimension's composite (platform, source_product_id) primary key —
 * same "cursor, not OFFSET" principle used by Track A ingestion and the AI
 * pipeline's candidate selection elsewhere in this codebase, so a product
 * added or removed mid-sweep can't cause rows to be silently skipped or
 * double-counted the way OFFSET pagination would.
 */
export async function detectAllProductSignals(
  window: DateWindow,
  thresholds: SignalThresholds = config.earlyWarning,
  batchSize = 100,
): Promise<CatalogSignalSweepResult> {
  const schema = config.appStore.schema;
  const signals: EarlyWarningSignal[] = [];
  let productsScanned = 0;
  let cursorPlatform = "";
  let cursorProductId = "";

  for (;;) {
    const batch = await appSequelize.query<{ platform: Platform; source_product_id: string }>(
      `SELECT platform, source_product_id
       FROM "${schema}".product_dimension
       WHERE (platform, source_product_id) > (:cursorPlatform, :cursorProductId)
       ORDER BY platform ASC, source_product_id ASC
       LIMIT :batchSize`,
      { type: QueryTypes.SELECT, replacements: { cursorPlatform, cursorProductId, batchSize } },
    );
    if (batch.length === 0) break;

    for (const row of batch) {
      const productSignals = await detectProductSignals(row.platform, row.source_product_id, window, thresholds);
      signals.push(...productSignals);
      productsScanned++;
    }

    const last = batch[batch.length - 1]!;
    cursorPlatform = last.platform;
    cursorProductId = last.source_product_id;

    if (batch.length < batchSize) break;
  }

  return { signals, productsScanned };
}
