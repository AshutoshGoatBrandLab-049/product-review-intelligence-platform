import { computeCoreMetrics, type CoreMetrics } from "./coreMetrics.js";
import { comparePeriods, type PeriodComparison } from "./periodComparison.js";
import { previousEquivalentWindow, type DateWindow } from "./dateWindows.js";
import { classifyTrendDirection, type TrendDirection } from "./productAnalytics.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 3 §9 — Flipkart, Myntra, and combined are three calls to the same
 * underlying rollup (`platform: undefined` = combined = no WHERE filter),
 * never a separately-maintained "combined" table that could drift.
 */
export interface PlatformAnalytics {
  platform: Platform | "combined";
  recentMetrics: CoreMetrics;
  historicalMetrics: CoreMetrics;
  ratingComparison: PeriodComparison;
  trendDirection: TrendDirection;
}

export async function computePlatformAnalytics(window: DateWindow, platform?: Platform): Promise<PlatformAnalytics> {
  const previousWindow = previousEquivalentWindow(window);

  const [recentMetrics, historicalMetrics] = await Promise.all([
    computeCoreMetrics({ window, platform }),
    computeCoreMetrics({ window: previousWindow, platform }),
  ]);

  const ratingComparison = comparePeriods(recentMetrics.averageRating ?? 0, historicalMetrics.averageRating ?? 0);
  const trendDirection = classifyTrendDirection(ratingComparison, recentMetrics.confidence, historicalMetrics.confidence);

  return { platform: platform ?? "combined", recentMetrics, historicalMetrics, ratingComparison, trendDirection };
}
