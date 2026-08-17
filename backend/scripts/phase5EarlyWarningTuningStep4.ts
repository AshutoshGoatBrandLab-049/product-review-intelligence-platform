import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { detectAllProductSignals, countComplaintThemeMentions, type SignalThresholds } from "../src/modules/analytics/earlyWarning.js";
import { computeProductAnalytics } from "../src/modules/analytics/productAnalytics.js";
import { resolveNamedWindow, previousEquivalentWindow } from "../src/modules/analytics/dateWindows.js";

function percentileOf(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/**
 * Phase 5 Step 4 — tunes early-warning thresholds against the real, restored
 * local dataset. Entirely READ-ONLY: detectAllProductSignals/detectProductSignals
 * never write anything, and this script issues no INSERT/UPDATE/DELETE of its
 * own. Two parts:
 *   A. Run the 3 pre-existing thresholds against real data, report the
 *      observed firing distribution — the basis for deciding whether to
 *      adjust them (only if clearly too noisy or too dead).
 *   B. Compute the REAL complaint-mention growth-rate distribution across
 *      every real product (no threshold applied yet — this is the raw data
 *      used to derive complaintSpikePercent's first-ever default, empirically,
 *      not guessed).
 */
async function main(): Promise<void> {
  if (config.appStore.database === "pri_test_appstore") {
    throw new Error("Refusing to run: this script tunes against the REAL local dataset, not the isolated test fixture.");
  }
  console.log(`Running against: ${config.appStore.database} / schema ${config.appStore.schema}`);

  const window = resolveNamedWindow("90d");
  const previousWindow = previousEquivalentWindow(window);
  console.log(`Recent window: ${window.start}..${window.end}   Historical window: ${previousWindow.start}..${previousWindow.end}`);

  // ── Part A: sweep with the 3 current, pre-existing thresholds ──────────
  const currentThresholds: SignalThresholds = {
    ratingDeclinePercent: config.earlyWarning.ratingDeclinePercent,
    negativeReviewIncreasePercent: config.earlyWarning.negativeReviewIncreasePercent,
    volumeSpikeMultiplier: config.earlyWarning.volumeSpikeMultiplier,
    // complaintSpikePercent deliberately omitted — no default exists yet (that's what Part B derives).
  };

  const startedAt = Date.now();
  const sweep = await detectAllProductSignals(window, currentThresholds);
  const sweepDurationMs = Date.now() - startedAt;

  const byType: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const s of sweep.signals) {
    byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;
    byConfidence[s.confidence] = (byConfidence[s.confidence] ?? 0) + 1;
  }

  console.log("\n=== Part A: Sweep with the 3 current thresholds (real data) ===");
  console.log(
    JSON.stringify(
      {
        productsScanned: sweep.productsScanned,
        totalSignals: sweep.signals.length,
        byType,
        byConfidence,
        sweepDurationMs,
      },
      null,
      2,
    ),
  );

  const workingSignals = sweep.signals.filter((s) => s.signalType !== "complaint_spike" && s.signalType !== "product_deterioration");
  console.log(`\nRepresentative sample (first 10 of ${workingSignals.length} real signals from the 4 working types):`);
  console.log(JSON.stringify(workingSignals.slice(0, 10), null, 2));

  // ── Part B: real complaint-mention growth-rate distribution, no threshold applied ──
  const schema = config.appStore.schema;
  const productRows = await appSequelize.query<{ platform: "flipkart" | "myntra"; source_product_id: string }>(
    `SELECT platform, source_product_id FROM "${schema}".product_dimension ORDER BY platform, source_product_id`,
    { type: QueryTypes.SELECT },
  );

  const growthRates: number[] = [];
  let productsWithComputableGrowth = 0;
  let productsWithZeroBaseline = 0; // recent>0, historical=0 -> growth undefined, excluded (same null-on-zero-baseline rule the other signals use)
  let productsWithNoComplaintsEitherWindow = 0;

  const partBStartedAt = Date.now();
  for (const row of productRows) {
    const [recent, historical] = await Promise.all([
      countComplaintThemeMentions(row.platform, row.source_product_id, window),
      countComplaintThemeMentions(row.platform, row.source_product_id, previousWindow),
    ]);
    if (recent === 0 && historical === 0) {
      productsWithNoComplaintsEitherWindow++;
      continue;
    }
    if (historical === 0) {
      productsWithZeroBaseline++;
      continue;
    }
    growthRates.push(((recent - historical) / historical) * 100);
    productsWithComputableGrowth++;
  }
  const partBDurationMs = Date.now() - partBStartedAt;

  growthRates.sort((a, b) => a - b);

  console.log("\n=== Part B: Real complaint-mention growth-rate distribution ===");
  console.log(
    JSON.stringify(
      {
        totalProducts: productRows.length,
        productsWithNoComplaintsEitherWindow,
        productsWithZeroBaselineComplaints_excludedFromDistribution: productsWithZeroBaseline,
        productsWithComputableGrowthRate: productsWithComputableGrowth,
        growthRateDistributionPercent: {
          min: growthRates[0] ?? null,
          p25: percentileOf(growthRates, 25),
          median: percentileOf(growthRates, 50),
          p75: percentileOf(growthRates, 75),
          p90: percentileOf(growthRates, 90),
          p95: percentileOf(growthRates, 95),
          max: growthRates[growthRates.length - 1] ?? null,
        },
        candidate_200pct_fractionOfComputable: growthRates.filter((r) => r >= 200).length / (growthRates.length || 1),
        candidate_200pct_fractionOfFullCatalog: growthRates.filter((r) => r >= 200).length / productRows.length,
        partBDurationMs,
      },
      null,
      2,
    ),
  );

  // ── Part C: raw distributions for the 2 highest-firing existing signals —
  // justifies whether "too noisy" adjustment is actually warranted, with the
  // same rigor as Part B, not a gut reaction to a firing percentage. ──
  const volumeRatios: number[] = [];
  const negativeGrowthRates: number[] = [];
  const partCStartedAt = Date.now();
  for (const row of productRows) {
    const analytics = await computeProductAnalytics(row.platform, row.source_product_id, window);
    const { recentMetrics, historicalMetrics } = analytics;
    if (historicalMetrics.totalReviews > 0) {
      volumeRatios.push(recentMetrics.totalReviews / historicalMetrics.totalReviews);
    }
    if (recentMetrics.negativePercentage !== null && historicalMetrics.negativePercentage !== null && historicalMetrics.negativePercentage > 0) {
      negativeGrowthRates.push(((recentMetrics.negativePercentage - historicalMetrics.negativePercentage) / historicalMetrics.negativePercentage) * 100);
    }
  }
  const partCDurationMs = Date.now() - partCStartedAt;
  volumeRatios.sort((a, b) => a - b);
  negativeGrowthRates.sort((a, b) => a - b);

  console.log("\n=== Part C: raw distributions for review_volume_spike (ratio) and sudden_negative_review_increase (percent growth) ===");
  console.log(
    JSON.stringify(
      {
        volumeRatio: {
          n: volumeRatios.length,
          median: percentileOf(volumeRatios, 50),
          p75: percentileOf(volumeRatios, 75),
          p90: percentileOf(volumeRatios, 90),
          p95: percentileOf(volumeRatios, 95),
          max: volumeRatios[volumeRatios.length - 1] ?? null,
          fractionAtOrAbove_currentThreshold_2x: volumeRatios.filter((r) => r >= 2).length / (volumeRatios.length || 1),
          fractionAtOrAbove_candidate_3x: volumeRatios.filter((r) => r >= 3).length / (volumeRatios.length || 1),
        },
        negativeGrowthPercent: {
          n: negativeGrowthRates.length,
          median: percentileOf(negativeGrowthRates, 50),
          p75: percentileOf(negativeGrowthRates, 75),
          p90: percentileOf(negativeGrowthRates, 90),
          p95: percentileOf(negativeGrowthRates, 95),
          max: negativeGrowthRates[negativeGrowthRates.length - 1] ?? null,
          fractionAtOrAbove_currentThreshold_20pct: negativeGrowthRates.filter((r) => r >= 20).length / (negativeGrowthRates.length || 1),
          fractionAtOrAbove_candidate_40pct: negativeGrowthRates.filter((r) => r >= 40).length / (negativeGrowthRates.length || 1),
          fractionAtOrAbove_candidate_100pct: negativeGrowthRates.filter((r) => r >= 100).length / (negativeGrowthRates.length || 1),
        },
        partCDurationMs,
      },
      null,
      2,
    ),
  );

  await appSequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
