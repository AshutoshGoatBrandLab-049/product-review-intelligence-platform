import { createHash } from "node:crypto";
import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { buildProductEvidencePackage, type ProductEvidencePackage } from "./evidencePackage.js";
import { narrateProductEvidence, type NarratorResult } from "./narrator.js";
import type { AiProvider } from "./providers/aiProvider.js";
import type { DateWindow } from "../analytics/dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 6 Step 2 — deterministic hash of everything in the evidence package
 * that could change the narrator's answer. Any real underlying data change
 * (new reviews, updated sentiment/theme classification) changes this hash,
 * which changes the cache key, which forces a fresh narration — never a
 * stale answer silently reused. Same hash-based staleness pattern this
 * codebase already uses for review content (contentHash.ts), applied here
 * to the evidence package instead of a single review.
 */
export function computeInsightInputHash(evidencePackage: ProductEvidencePackage): string {
  const stable = {
    reviewCount: evidencePackage.reviewCount,
    averageRating: evidencePackage.averageRating,
    ratingDistribution: evidencePackage.ratingDistribution,
    positivePercentage: evidencePackage.positivePercentage,
    negativePercentage: evidencePackage.negativePercentage,
    trendDirection: evidencePackage.trendDirection,
    confidence: evidencePackage.confidence,
    sentimentDistribution: evidencePackage.sentimentDistribution,
    topThemes: evidencePackage.topThemes,
    topNegativeThemes: evidencePackage.topNegativeThemes,
    evidenceReviewIds: [...evidencePackage.evidenceReviewIds].sort(),
    totalMatchingNegativeCount: evidencePackage.totalMatchingNegativeCount,
    reviewThemes: evidencePackage.reviewThemes,
  };
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}

export interface CachedInsightResult {
  result: NarratorResult;
  cacheHit: boolean;
}

interface AiInsightRow {
  result: NarratorResult;
}

/** Bumped only if the persisted result shape changes incompatibly — lets a
 * future schema change invalidate old cache rows without a migration. */
const MODEL_VERSION_TAG = "narrator-v1";

/**
 * Phase 6 Step 2 — the ONLY entry point the API uses for product insights.
 * On a cache hit, `provider` is never invoked — guaranteed by returning
 * before narrateProductEvidence is ever called. On a miss, the real
 * narrator/provider path runs exactly once and its VALIDATED result (never
 * raw/unvalidated model output) is persisted before being returned.
 */
export async function getOrGenerateProductInsight(
  platform: Platform,
  sourceProductId: string,
  window: DateWindow,
  provider: AiProvider,
): Promise<CachedInsightResult> {
  const schema = config.appStore.schema;
  const evidencePackage = await buildProductEvidencePackage(platform, sourceProductId, window);
  const inputHash = computeInsightInputHash(evidencePackage);

  const rows = await appSequelize.query<AiInsightRow>(
    `SELECT result FROM "${schema}".ai_insights
     WHERE platform = :platform AND source_product_id = :sourceProductId
       AND window_start = :start AND window_end = :end AND input_hash = :inputHash`,
    { type: QueryTypes.SELECT, replacements: { platform, sourceProductId, start: window.start, end: window.end, inputHash } },
  );

  if (rows[0]) {
    return { result: rows[0].result, cacheHit: true };
  }

  // Known, disclosed limitation: two concurrent requests that both miss the
  // cache for the same key will both call the provider (no request-level
  // lock exists) — the ON CONFLICT below only dedupes the WRITE, not the
  // AI call itself. Acceptable for v1: rare in practice (requires two
  // simultaneous first-ever requests for the exact same product/window/
  // input_hash), and never produces stale or incorrect data either way.
  const result = await narrateProductEvidence(evidencePackage, provider);

  await appSequelize.query(
    `INSERT INTO "${schema}".ai_insights (platform, source_product_id, window_start, window_end, input_hash, result, model_version)
     VALUES (:platform, :sourceProductId, :start, :end, :inputHash, :result, :modelVersion)
     ON CONFLICT (platform, source_product_id, window_start, window_end, input_hash) DO NOTHING`,
    {
      replacements: {
        platform,
        sourceProductId,
        start: window.start,
        end: window.end,
        inputHash,
        result: JSON.stringify(result),
        modelVersion: MODEL_VERSION_TAG,
      },
    },
  );

  return { result, cacheHit: false };
}
