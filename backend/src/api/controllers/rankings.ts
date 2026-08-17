import type { Request, Response } from "express";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { getValidatedQuery } from "../middleware/validate.js";
import { categoryCCache } from "../categoryCCache.js";
import { computeCatalogHealthScores, computeCatalogAnalytics, type CatalogHealthEntry, type CatalogAnalyticsEntry } from "../catalogSweep.js";
import type { RankingsQuery } from "../schemas.js";

/**
 * GET /v1/products/rankings — Category C. sort=health reuses the exact same
 * catalog health-score sweep (and cache entry) as the dashboard endpoint;
 * sort=rating uses computeProductAnalytics instead — both are the existing
 * Phase 3/4 functions, this controller only sorts/paginates their output.
 */
export async function getProductRankings(req: Request, res: Response): Promise<void> {
  const { window: namedWindow, sort, platform, brand, page, pageSize } = getValidatedQuery<RankingsQuery>(req);
  const window = resolveNamedWindow(namedWindow);
  const cacheKey = `rankings:${sort}:${namedWindow}:${platform ?? "all"}:${brand ?? "all"}`;

  let cacheHit: boolean;
  let ranked: Array<{ platform: string; sourceProductId: string; brand: string | null; sortValue: number | null; data: unknown }>;

  if (sort === "health") {
    const result = await categoryCCache.getOrCompute(cacheKey, () => computeCatalogHealthScores(window, platform, brand));
    cacheHit = result.cacheHit;
    ranked = (result.value as CatalogHealthEntry[])
      .map((e) => ({ platform: e.platform, sourceProductId: e.sourceProductId, brand: e.brand, sortValue: e.health.ratingScore, data: e.health }))
      .sort((a, b) => (b.sortValue ?? -1) - (a.sortValue ?? -1));
  } else {
    const result = await categoryCCache.getOrCompute(cacheKey, () => computeCatalogAnalytics(window, platform, brand));
    cacheHit = result.cacheHit;
    ranked = (result.value as CatalogAnalyticsEntry[])
      .map((e) => ({
        platform: e.platform,
        sourceProductId: e.sourceProductId,
        brand: e.brand,
        sortValue: e.analytics.recentMetrics.averageRating,
        data: e.analytics,
      }))
      .sort((a, b) => (b.sortValue ?? -1) - (a.sortValue ?? -1));
  }

  const start = (page - 1) * pageSize;
  const pageItems = ranked.slice(start, start + pageSize);

  res.json({
    window,
    cacheHit,
    sort,
    page,
    pageSize,
    totalCount: ranked.length,
    items: pageItems,
  });
}
