import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeCoreMetrics, type CoreMetrics } from "./coreMetrics.js";
import { comparePeriods, type PeriodComparison } from "./periodComparison.js";
import { previousEquivalentWindow, type DateWindow } from "./dateWindows.js";
import { classifyTrendDirection, type TrendDirection } from "./productAnalytics.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 3 §8 — brand rollups always go through product_dimension.brand
 * (the deterministic per-product brand label), never a fresh scan of
 * normalized_reviews.brand. `platform: undefined` means "combined" — the sum
 * across both platforms, still fully traceable since product_daily_metrics
 * retains its own platform column underneath.
 */
export interface BrandAnalytics {
  brand: string;
  platform: Platform | "combined";
  productCount: number;
  recentMetrics: CoreMetrics;
  historicalMetrics: CoreMetrics;
  ratingComparison: PeriodComparison;
  trendDirection: TrendDirection;
}

export async function computeBrandAnalytics(
  brand: string,
  window: DateWindow,
  platform?: Platform,
): Promise<BrandAnalytics> {
  const schema = config.appStore.schema;
  const previousWindow = previousEquivalentWindow(window);

  const [recentMetrics, historicalMetrics, productCountRow] = await Promise.all([
    computeCoreMetrics({ window, platform, brand }),
    computeCoreMetrics({ window: previousWindow, platform, brand }),
    appSequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${schema}".product_dimension
       WHERE brand = :brand ${platform ? "AND platform = :platform" : ""}`,
      { type: QueryTypes.SELECT, replacements: { brand, platform: platform ?? "" } },
    ),
  ]);

  const ratingComparison = comparePeriods(recentMetrics.averageRating ?? 0, historicalMetrics.averageRating ?? 0);
  const trendDirection = classifyTrendDirection(ratingComparison, recentMetrics.confidence, historicalMetrics.confidence);

  return {
    brand,
    platform: platform ?? "combined",
    productCount: Number(productCountRow[0]!.count),
    recentMetrics,
    historicalMetrics,
    ratingComparison,
    trendDirection,
  };
}
