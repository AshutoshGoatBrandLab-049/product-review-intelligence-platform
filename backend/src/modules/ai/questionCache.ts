import { createHash } from "node:crypto";
import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import type { ProductAnalystResponse } from "../../api/controllers/analyst.js";
import type { DateWindow } from "../analytics/dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 10 Step 2 — Question caching with 30-day TTL.
 * Cache key includes platform, sourceProductId, window, and normalized question text.
 * Prevents duplicate AI calls for identical questions within the same conversation context.
 * Cache entries older than 30 days are not served (staleness boundary).
 */

export function computeQuestionHash(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
  question: string,
): string {
  const normalizedQuestion = question.toLowerCase().trim();
  const key = JSON.stringify({
    platform,
    sourceProductId,
    windowStart: window.start,
    windowEnd: window.end,
    question: normalizedQuestion,
  });
  return createHash("sha256").update(key, "utf8").digest("hex");
}

interface CachedQuestionRow {
  result: ProductAnalystResponse;
  created_at: Date;
}

const CACHE_TTL_DAYS = 30;
const MODEL_VERSION_TAG = "analyst-v1";

/**
 * Phase 10 Step 2 — Retrieve cached question result if available and not stale.
 * Returns null if cache miss or if cached entry exceeds 30-day TTL.
 */
export async function getCachedQuestion(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
  question: string,
): Promise<ProductAnalystResponse | null> {
  const schema = config.appStore.schema;
  const questionHash = computeQuestionHash(platform, sourceProductId, window, question);
  const ttlBoundary = new Date();
  ttlBoundary.setDate(ttlBoundary.getDate() - CACHE_TTL_DAYS);

  const rows = await appSequelize.query<CachedQuestionRow>(
    `SELECT result, created_at FROM "${schema}".ai_question_cache
     WHERE platform = :platform AND source_product_id = :sourceProductId
       AND window_start = :start AND window_end = :end AND question_hash = :questionHash
       AND created_at > :ttlBoundary`,
    {
      type: QueryTypes.SELECT,
      replacements: { platform, sourceProductId, start: window.start, end: window.end, questionHash, ttlBoundary },
    },
  );

  if (rows[0]) {
    return { ...rows[0].result, cacheHit: true };
  }

  return null;
}

/**
 * Phase 10 Step 2 — Cache a validated question result.
 * ON CONFLICT handles race conditions where two concurrent requests both miss cache.
 */
export async function cacheQuestion(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
  question: string,
  result: ProductAnalystResponse,
): Promise<void> {
  const schema = config.appStore.schema;
  const questionHash = computeQuestionHash(platform, sourceProductId, window, question);
  const normalizedQuestion = question.toLowerCase().trim();

  await appSequelize.query(
    `INSERT INTO "${schema}".ai_question_cache
     (platform, source_product_id, window_start, window_end, question_hash, question_text, result, model_version)
     VALUES (:platform, :sourceProductId, :start, :end, :questionHash, :questionText, :result, :modelVersion)
     ON CONFLICT (platform, source_product_id, window_start, window_end, question_hash) DO NOTHING`,
    {
      replacements: {
        platform,
        sourceProductId,
        start: window.start,
        end: window.end,
        questionHash,
        questionText: normalizedQuestion,
        result: JSON.stringify(result),
        modelVersion: MODEL_VERSION_TAG,
      },
    },
  );
}
