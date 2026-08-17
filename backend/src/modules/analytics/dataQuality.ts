import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeCompletenessAudit, type CompletenessAudit } from "../ingestion/shared/completenessAudit.js";
import { CONFIDENCE_THRESHOLDS } from "./confidence.js";
import type { DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

export interface DataQualityReport {
  platform: Platform;
  window: DateWindow;
  completeness: CompletenessAudit; // reused from Phase 2.1, not reimplemented
  rejectsByReason: Array<{ reason: string; count: number }>;
  identityAnomaliesInWindow: number;
  brandInconsistentProducts: number;
  lowSampleProducts: number; // products below minReviewsForLowConfidence within window
}

/**
 * Phase 3 §20 — nothing is ever silently excluded from a raw count here;
 * this report surfaces exclusions and low-confidence scopes, it doesn't
 * hide them. Reuses Phase 2.1's completeness audit (§9b's dedup fix) rather
 * than recomputing the same thing a second way.
 */
export async function computeDataQualityReport(platform: Platform, window: DateWindow, sourceTotal: number): Promise<DataQualityReport> {
  const schema = config.appStore.schema;

  const [completeness, rejectRows, anomalyRows, inconsistentRows, lowSampleRows] = await Promise.all([
    computeCompletenessAudit(platform, sourceTotal),
    appSequelize.query<{ reason: string; count: string }>(
      `SELECT reason, count(*)::text AS count FROM "${schema}".ingestion_rejects WHERE platform = :platform GROUP BY reason`,
      { type: QueryTypes.SELECT, replacements: { platform } },
    ),
    appSequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${schema}".identity_anomalies a
       JOIN "${schema}".normalized_reviews n ON n.canonical_review_id = a.canonical_review_id
       WHERE a.platform = :platform AND n.review_date >= :start AND n.review_date <= :end`,
      { type: QueryTypes.SELECT, replacements: { platform, start: window.start, end: window.end } },
    ),
    appSequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${schema}".product_dimension WHERE platform = :platform AND brand_inconsistent = true`,
      { type: QueryTypes.SELECT, replacements: { platform } },
    ),
    appSequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (
         SELECT source_product_id, sum(review_count) AS c
         FROM "${schema}".product_daily_metrics
         WHERE platform = :platform AND review_date >= :start AND review_date <= :end
         GROUP BY source_product_id
         HAVING sum(review_count) < :minReviews
       ) low`,
      {
        type: QueryTypes.SELECT,
        replacements: { platform, start: window.start, end: window.end, minReviews: CONFIDENCE_THRESHOLDS.minReviewsForLowConfidence },
      },
    ),
  ]);

  return {
    platform,
    window,
    completeness,
    rejectsByReason: rejectRows.map((r) => ({ reason: r.reason, count: Number(r.count) })),
    identityAnomaliesInWindow: Number(anomalyRows[0]!.count),
    brandInconsistentProducts: Number(inconsistentRows[0]!.count),
    lowSampleProducts: Number(lowSampleRows[0]!.count),
  };
}
