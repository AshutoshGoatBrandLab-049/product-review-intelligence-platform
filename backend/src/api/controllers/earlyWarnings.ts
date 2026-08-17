import type { Request, Response } from "express";
import { detectAllProductSignals } from "../../modules/analytics/earlyWarning.js";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { config } from "../../config/index.js";
import { getValidatedQuery } from "../middleware/validate.js";
import { categoryCCache } from "../categoryCCache.js";
import { listCatalogProducts } from "../catalogSweep.js";
import type { EarlyWarningsQuery } from "../schemas.js";
import type { EarlyWarningSignal } from "../../modules/analytics/earlyWarning.js";

/**
 * GET /v1/early-warnings — Category C. Wraps detectAllProductSignals (the
 * exact Phase 5 function, no reimplementation) in the shared short-TTL
 * cache — one entry per window, reused across every filter combination so
 * filtering never fragments or bypasses the cache. platform/brand filters
 * are applied to the already-computed signals afterward; brand filtering
 * reuses catalogSweep's product_dimension lookup (the same helper the
 * rankings/dashboard endpoints use) rather than inventing a second way to
 * resolve brand membership.
 */
export async function getEarlyWarnings(req: Request, res: Response): Promise<void> {
  const { window: namedWindow, platform, brand } = getValidatedQuery<EarlyWarningsQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const cacheKey = `early-warnings:${namedWindow}`;
  const { value: sweep, cacheHit } = await categoryCCache.getOrCompute(cacheKey, () =>
    detectAllProductSignals(window, config.earlyWarning, 100),
  );

  let signals = (sweep as { signals: EarlyWarningSignal[]; productsScanned: number }).signals;
  if (platform) signals = signals.filter((s) => s.platform === platform);
  if (brand) {
    const brandProducts = await listCatalogProducts(platform, brand);
    const allowed = new Set(brandProducts.map((p) => `${p.platform}:${p.sourceProductId}`));
    signals = signals.filter((s) => allowed.has(`${s.platform}:${s.sourceProductId}`));
  }

  res.json({
    window,
    cacheHit,
    filters: { platform: platform ?? null, brand: brand ?? null },
    productsScanned: (sweep as { productsScanned: number }).productsScanned,
    signals,
  });
}
