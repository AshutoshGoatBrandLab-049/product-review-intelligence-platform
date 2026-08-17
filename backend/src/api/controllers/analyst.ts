import type { Request, Response } from "express";
import { analyzeProductQuestion } from "../../modules/ai/productAnalyst.js";
import { createAiProvider } from "../../modules/ai/providers/providerFactory.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { ProductParams, AnalystQuery } from "../schemas.js";
import type { DateWindow } from "../../modules/analytics/dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { NarratorResult } from "../../modules/ai/narrator.js";

export interface ProductAnalystResponse {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  userQuestion: string;
  answer: string;
  analysis: NarratorResult;
  cacheHit: boolean;
}

/**
 * Phase 10 Step 2 — AI Product Analyst endpoint with question caching.
 * User asks a question about a product → check cache → get grounded analysis backed by real data.
 * All responses are validated narrator output, never raw model output.
 */

export async function analyzeProduct(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const { question, window } = getValidatedQuery<AnalystQuery>(req);

  const provider = createAiProvider();
  const result = await analyzeProductQuestion(
    {
      platform,
      sourceProductId,
      userQuestion: question,
      window,
    },
    provider,
  );

  res.json(result);
}
