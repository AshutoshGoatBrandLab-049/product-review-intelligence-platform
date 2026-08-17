import type { Request, Response } from "express";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import { computeProblemsAggregate } from "../../modules/analytics/problemsAggregate.js";
import { getValidatedQuery } from "../middleware/validate.js";
import { categoryCCache } from "../categoryCCache.js";
import type { ProblemsQuery } from "../schemas.js";
import type { ProblemThemeSummary } from "../../modules/analytics/problemsAggregate.js";

/**
 * GET /v1/problems — Category C by scope, cheap by cost (single grouped
 * query, 197.0ms real-measured at full catalog scale — see
 * scripts/phase6CategoryCBenchmark.ts). No severity field anywhere in the
 * response: severity.ts has no approved formula, so none is fabricated here.
 */
export async function getProblems(req: Request, res: Response): Promise<void> {
  const { window: namedWindow, platform, theme } = getValidatedQuery<ProblemsQuery>(req);
  const window = resolveNamedWindow(namedWindow);
  const cacheKey = `problems:${namedWindow}:${platform ?? "all"}:${theme ?? "all"}`;

  const { value: themes, cacheHit } = await categoryCCache.getOrCompute(cacheKey, () => computeProblemsAggregate({ window, platform, theme }));

  res.json({ window, cacheHit, filters: { platform: platform ?? null, theme: theme ?? null }, themes: themes as ProblemThemeSummary[] });
}
