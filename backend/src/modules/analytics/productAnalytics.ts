import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeCoreMetrics, type CoreMetrics } from "./coreMetrics.js";
import { comparePeriods, type PeriodComparison } from "./periodComparison.js";
import { previousEquivalentWindow, type DateWindow } from "./dateWindows.js";
import { classifyConfidence, type ConfidenceLevel } from "./confidence.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 3 approved trend threshold: +10%/-10% on average-rating percentage
 * change, gated by confidence on BOTH compared periods. Configurable, not
 * hardcoded inline in the classification logic.
 */
export const TREND_THRESHOLDS = {
  improveAtOrAbovePercent: 10,
  declineAtOrBelowPercent: -10,
} as const;

export type TrendDirection = "improving" | "declining" | "stable" | "insufficient_data";

export function classifyTrendDirection(
  ratingComparison: PeriodComparison,
  currentConfidence: ConfidenceLevel,
  previousConfidence: ConfidenceLevel,
  thresholds: typeof TREND_THRESHOLDS = TREND_THRESHOLDS,
): TrendDirection {
  if (currentConfidence === "insufficient_data" || previousConfidence === "insufficient_data") {
    return "insufficient_data";
  }
  if (ratingComparison.percentageDelta === null) return "insufficient_data";
  if (ratingComparison.percentageDelta >= thresholds.improveAtOrAbovePercent) return "improving";
  if (ratingComparison.percentageDelta <= thresholds.declineAtOrBelowPercent) return "declining";
  return "stable";
}

export interface ProductAnalytics {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
  brandInconsistent: boolean;
  recentMetrics: CoreMetrics;
  historicalMetrics: CoreMetrics;
  ratingComparison: PeriodComparison;
  trendDirection: TrendDirection;
}

export async function computeProductAnalytics(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
): Promise<ProductAnalytics> {
  const schema = config.appStore.schema;
  const previousWindow = previousEquivalentWindow(window);

  const [recentMetrics, historicalMetrics, dimensionRow] = await Promise.all([
    computeCoreMetrics({ window, platform, sourceProductId }),
    computeCoreMetrics({ window: previousWindow, platform, sourceProductId }),
    appSequelize.query<{ brand: string | null; brand_inconsistent: boolean }>(
      `SELECT brand, brand_inconsistent FROM "${schema}".product_dimension WHERE platform = :platform AND source_product_id = :sourceProductId`,
      { type: QueryTypes.SELECT, replacements: { platform, sourceProductId } },
    ),
  ]);

  const dimension = dimensionRow[0] ?? { brand: null, brand_inconsistent: false };
  const ratingComparison = comparePeriods(recentMetrics.averageRating ?? 0, historicalMetrics.averageRating ?? 0);
  const trendDirection = classifyTrendDirection(ratingComparison, recentMetrics.confidence, historicalMetrics.confidence);

  return {
    platform,
    sourceProductId,
    brand: dimension.brand,
    brandInconsistent: dimension.brand_inconsistent,
    recentMetrics,
    historicalMetrics,
    ratingComparison,
    trendDirection,
  };
}
