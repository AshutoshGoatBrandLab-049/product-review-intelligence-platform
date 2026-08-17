import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { classifyConfidence, CONFIDENCE_THRESHOLDS, type ConfidenceLevel } from "./confidence.js";
import type { DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 6 §1A/§4 — cross-product theme clustering for GET /v1/problems.
 * Deliberately a single grouped aggregate query, not a per-product loop —
 * this is what keeps it cheap despite being catalog-wide (Category C by
 * scope, not by cost). "Complaint" mention uses the exact same deterministic
 * proxy earlyWarning.ts's complaint_spike already established (rating<=2 OR
 * sentiment=negative) — not a new definition invented here.
 *
 * severity is deliberately absent: severity.ts has no approved formula
 * (Phase 4 §19, reconfirmed Phase 5/6) — there is nothing honest to compute
 * for it, so no field is emitted, never a fabricated/defaulted value.
 */
export interface ProblemThemeSummary {
  theme: string;
  mentionCount: number;
  distinctReviewCount: number;
  distinctProductCount: number;
  confidence: ConfidenceLevel;
}

export interface ProblemsAggregateFilter {
  window: DateWindow;
  platform?: Platform;
  theme?: string;
}

export async function computeProblemsAggregate(filter: ProblemsAggregateFilter): Promise<ProblemThemeSummary[]> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<{
    theme: string;
    mention_count: string;
    distinct_review_count: string;
    distinct_product_count: string;
  }>(
    `SELECT
       rt.theme,
       count(*)::text AS mention_count,
       count(DISTINCT nr.canonical_review_id)::text AS distinct_review_count,
       count(DISTINCT (nr.platform, nr.source_product_id))::text AS distinct_product_count
     FROM "${schema}".review_theme rt
     JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rt.canonical_review_id
     LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = rt.canonical_review_id
     WHERE nr.review_date >= :start AND nr.review_date <= :end
       AND (nr.rating <= 2 OR rs.label = 'negative')
       AND (:platform::text IS NULL OR nr.platform = :platform)
       AND (:theme::text IS NULL OR rt.theme = :theme)
     GROUP BY rt.theme
     ORDER BY count(*) DESC`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        start: filter.window.start,
        end: filter.window.end,
        platform: filter.platform ?? null,
        theme: filter.theme ?? null,
      },
    },
  );

  return rows.map((r) => ({
    theme: r.theme,
    mentionCount: Number(r.mention_count),
    distinctReviewCount: Number(r.distinct_review_count),
    distinctProductCount: Number(r.distinct_product_count),
    confidence: classifyConfidence(Number(r.distinct_review_count), CONFIDENCE_THRESHOLDS),
  }));
}
