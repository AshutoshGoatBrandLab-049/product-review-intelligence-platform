import type { Request, Response } from "express";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { detectAllProductSignals, type EarlyWarningSignal } from "../../modules/analytics/earlyWarning.js";
import { config } from "../../config/index.js";
import { getValidatedQuery } from "../middleware/validate.js";
import { categoryCCache } from "../categoryCCache.js";
import { computeCatalogHealthScores, type CatalogHealthEntry } from "../catalogSweep.js";
import type { WindowQuery } from "../schemas.js";

/**
 * GET /v1/dashboard/executive — Category C. computeHealthScore looped over
 * the full catalog (catalogSweep.ts), cached. Summary numbers here are
 * plain aggregation over each product's already-computed HealthScore/
 * ratingScore — never a new formula. totalScore stays null on every entry
 * (healthScore.ts's own guarantee), so "top movers by health" necessarily
 * ranks by ratingScore/trendScore, the only two fields ever non-null.
 */
export async function getExecutiveDashboard(req: Request, res: Response): Promise<void> {
  const { window: namedWindow } = getValidatedQuery<WindowQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const cacheKey = `dashboard:${namedWindow}`;
  const { value: entries, cacheHit } = await categoryCCache.getOrCompute(cacheKey, () => computeCatalogHealthScores(window));
  const catalog = entries as CatalogHealthEntry[];

  // Same cache key the /v1/early-warnings controller uses — a request to
  // either endpoint for the same window warms the other's cache entry too.
  const { value: sweep } = await categoryCCache.getOrCompute(`early-warnings:${namedWindow}`, () =>
    detectAllProductSignals(window, config.earlyWarning, 100),
  );
  const activeAlertCount = (sweep as { signals: EarlyWarningSignal[] }).signals.filter((s) => s.confidence !== "not_ready").length;

  const withRating = catalog.filter((e) => e.health.ratingScore !== null);
  const topMovers = [...withRating].sort((a, b) => b.health.trendScore - a.health.trendScore).slice(0, 10);
  const bottomMovers = [...withRating].sort((a, b) => a.health.trendScore - b.health.trendScore).slice(0, 10);

  res.json({
    window,
    cacheHit,
    productCount: catalog.length,
    activeAlertCount,
    averageRatingScore: withRating.length === 0 ? null : withRating.reduce((sum, e) => sum + e.health.ratingScore, 0) / withRating.length,
    topMovers: topMovers.map((e) => ({ platform: e.platform, sourceProductId: e.sourceProductId, brand: e.brand, health: e.health })),
    bottomMovers: bottomMovers.map((e) => ({ platform: e.platform, sourceProductId: e.sourceProductId, brand: e.brand, health: e.health })),
  });
}
