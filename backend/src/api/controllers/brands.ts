import type { Request, Response } from "express";
import { compareBrandAcrossMarketplaces } from "../../modules/analytics/marketplaceComparison.js";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { BrandParams, WindowQuery } from "../schemas.js";

/** GET /v1/brands/:brand/compare — direct pass-through to
 * compareBrandAcrossMarketplaces (Category B — see benchmark notes). */
export async function getBrandComparison(req: Request, res: Response): Promise<void> {
  const { brand } = getValidatedParams<BrandParams>(req);
  const { window: namedWindow } = getValidatedQuery<WindowQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const comparison = await compareBrandAcrossMarketplaces(brand, window);
  res.json(comparison);
}
