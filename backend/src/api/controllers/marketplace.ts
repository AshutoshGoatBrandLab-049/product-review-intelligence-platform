import type { Request, Response } from "express";
import { compareProductByFamily } from "../../modules/analytics/marketplaceComparison.js";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { FamilyParams, WindowQuery } from "../schemas.js";

/**
 * GET /v1/products/family/:familyId/compare — direct pass-through to
 * compareProductByFamily. Returns { available: false, reason: "no_mapping" }
 * as-is (HTTP 200 — this is a valid, expected answer, not an error) for
 * every family that doesn't exist, which today is every real product since
 * product_family_mapping is genuinely empty (Phase 5 report §7/§10). The
 * API never fakes availability or hides the endpoint to avoid this state.
 */
export async function getProductFamilyComparison(req: Request, res: Response): Promise<void> {
  const { familyId } = getValidatedParams<FamilyParams>(req);
  const { window: namedWindow } = getValidatedQuery<WindowQuery>(req);
  const window = resolveNamedWindow(namedWindow);

  const comparison = await compareProductByFamily(familyId, window);
  res.json(comparison);
}
