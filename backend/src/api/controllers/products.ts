import type { Request, Response } from "express";
import { computeProductAnalytics } from "../../modules/analytics/productAnalytics.js";
import { computeHealthScore } from "../../modules/analytics/healthScore.js";
import { detectProductSignals } from "../../modules/analytics/earlyWarning.js";
import { getOrGenerateProductInsight } from "../../modules/ai/insightsCache.js";
import { createAiProvider } from "../../modules/ai/providers/providerFactory.js";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { ProductParams, WindowQuery } from "../schemas.js";

/** GET /v1/products/:platform/:sourceProductId — thin: resolves the window,
 * calls the two existing analytics functions, returns their results as-is. */
export async function getProductDetail(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const { window: namedWindow } = getValidatedQuery<WindowQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const [analytics, health] = await Promise.all([
    computeProductAnalytics(platform, sourceProductId, window),
    computeHealthScore(platform, sourceProductId, window),
  ]);

  res.json({ platform, sourceProductId, window, analytics, health });
}

/** GET /v1/products/:platform/:sourceProductId/signals — a direct pass
 * through to detectProductSignals; no filtering/reshaping of its output. */
export async function getProductSignals(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const { window: namedWindow } = getValidatedQuery<WindowQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const signals = await detectProductSignals(platform, sourceProductId, window);
  res.json({ platform, sourceProductId, window, signals });
}

/**
 * GET /v1/products/:platform/:sourceProductId/insights — the ONLY route
 * that can trigger an AI provider call, and only on a real cache miss
 * (getOrGenerateProductInsight enforces this, not this controller).
 */
export async function getProductInsights(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const { window: namedWindow } = getValidatedQuery<WindowQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const provider = createAiProvider();
  const { result, cacheHit } = await getOrGenerateProductInsight(platform, sourceProductId, window, provider);

  res.json({ platform, sourceProductId, window, cacheHit, insight: result });
}
