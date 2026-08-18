import type { Request, Response } from "express";
import { analyzeProductQuestion } from "../../modules/ai/productAnalyst.js";
import { createAiProvider } from "../../modules/ai/providers/providerFactory.js";
import { getValidatedParams, getValidatedQuery } from "../middleware/validate.js";
import type { ProductParams, AnalystQuery } from "../schemas.js";
import type { DateWindow } from "../../modules/analytics/dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";
import type { NarratorResult } from "../../modules/ai/narrator.js";
import type { RetrievedReview } from "../../modules/analytics/reviewRetrieval.js";

export interface ProductAnalystResponse {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  userQuestion: string;
  answer: string;
  /** null for retrieval / clarification responses — those never run the narrator. */
  analysis: NarratorResult | null;
  cacheHit: boolean;
  /** Present only for RETRIEVAL-intent responses — real DB-backed reviews, never AI-invented. */
  reviews?: RetrievedReview[];
  totalMatchingCount?: number;
  requestedLimit?: number;
  /** Present only when the question was too ambiguous to resolve, even with conversation context. */
  needsClarification?: boolean;
  clarificationPrompt?: string;
  /** Best-effort multi-intent disclosure — see productAnalyst.ts hasMultipleIntentCues(). */
  multiIntentDetected?: boolean;
  multiIntentNote?: string;
}

/**
 * Phase 10 Step 2 — AI Product Analyst endpoint with question caching.
 * User asks a question about a product → check cache → get grounded analysis backed by real data.
 * All responses are validated narrator output, never raw model output.
 *
 * Phase 10 AI Product Analyst intent/context correction: accepts an optional
 * conversationId so ambiguous follow-ups ("show me", "why?") resolve against
 * real prior-turn state instead of being reclassified blind.
 */

export async function analyzeProduct(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const { question, window, conversationId } = getValidatedQuery<AnalystQuery>(req);

  const provider = createAiProvider();
  const result = await analyzeProductQuestion(
    {
      platform,
      sourceProductId,
      userQuestion: question,
      window,
      conversationId,
    },
    provider,
  );

  res.json(result);
}
