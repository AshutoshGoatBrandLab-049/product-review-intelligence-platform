import { QueryTypes } from "sequelize";
import { appSequelize } from "../../../database/appStore/client.js";
import { config } from "../../../config/index.js";
import type { Platform } from "../../../types/unifiedReview.js";

export interface CompletenessAudit {
  platform: Platform;
  sourceTotal: number;
  distinctNormalized: number;
  distinctRejected: number;
  /**
   * Identity anomalies are NOT part of the completeness sum — an anomaly is
   * an annotation on an already-normalized row's update (Track B logs one
   * when an update looks like a wholesale identity swap), not a distinct
   * disposition a source row can have instead of being normalized or
   * rejected. Counting it into the total would double-count rows that are
   * both normalized AND flagged (Phase 2.1 §3 accounting rule).
   */
  identityAnomalies: number;
  accountedFor: number;
  missing: number;
}

/**
 * Phase 2.1 §3 — completeness accounting rule, fixed after Phase 2 §9b/§19
 * found it going negative: `ingestion_rejects` can (before Phase 2.1 §2's
 * fix) or, defensively, still in principle contain more than one historical
 * row per source row (e.g. one per distinct failure reason — Phase 2.1 §2C
 * Test 4) — so completeness must count DISTINCT rejected source rows, never
 * raw row counts, and identity anomalies are excluded from the sum entirely
 * (see the field doc above). The exact partition is:
 *
 *   distinctNormalized + distinctRejected == sourceTotal
 *
 * with identityAnomalies reported separately, never added in.
 */
export async function computeCompletenessAudit(platform: Platform, sourceTotal: number): Promise<CompletenessAudit> {
  const schema = config.appStore.schema;

  const [normalizedRow] = await appSequelize.query<{ count: string }>(
    `SELECT count(DISTINCT source_row_id)::text AS count FROM "${schema}".normalized_reviews WHERE platform = :platform`,
    { replacements: { platform }, type: QueryTypes.SELECT },
  );
  const [rejectedRow] = await appSequelize.query<{ count: string }>(
    `SELECT count(DISTINCT source_row_id)::text AS count FROM "${schema}".ingestion_rejects WHERE platform = :platform`,
    { replacements: { platform }, type: QueryTypes.SELECT },
  );
  const [anomalyRow] = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".identity_anomalies WHERE platform = :platform`,
    { replacements: { platform }, type: QueryTypes.SELECT },
  );

  const distinctNormalized = Number(normalizedRow?.count ?? "0");
  const distinctRejected = Number(rejectedRow?.count ?? "0");
  const identityAnomalies = Number(anomalyRow?.count ?? "0");
  const accountedFor = distinctNormalized + distinctRejected;

  return {
    platform,
    sourceTotal,
    distinctNormalized,
    distinctRejected,
    identityAnomalies,
    accountedFor,
    missing: sourceTotal - accountedFor,
  };
}
