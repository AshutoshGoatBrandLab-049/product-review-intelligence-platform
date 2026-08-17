import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import type { DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

const MAX_EVIDENCE_REVIEW_IDS = 20;

/**
 * Phase 3 §16 — every analytical claim that references specific reviews
 * carries an EvidenceReference: canonical_review_id[], never review text.
 * The array is capped (MAX_EVIDENCE_REVIEW_IDS) so a product with thousands
 * of matching reviews doesn't produce an unbounded record; totalMatchingCount
 * keeps the claim fully auditable regardless.
 */
export interface EvidenceReference {
  canonicalReviewIds: string[];
  totalMatchingCount: number;
  platform: Platform;
  dateWindow: DateWindow;
  query: string;
}

export interface EvidenceQuery {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  /** e.g. "rating <= 2" — a human-readable description of the filter, echoed back for audit. */
  description: string;
  ratingIn?: number[];
}

export async function findEvidence(evidenceQuery: EvidenceQuery): Promise<EvidenceReference> {
  const schema = config.appStore.schema;
  const conditions: string[] = [
    `platform = :platform`,
    `source_product_id = :sourceProductId`,
    `review_date >= :start`,
    `review_date <= :end`,
  ];
  const replacements: Record<string, unknown> = {
    platform: evidenceQuery.platform,
    sourceProductId: evidenceQuery.sourceProductId,
    start: evidenceQuery.window.start,
    end: evidenceQuery.window.end,
  };

  if (evidenceQuery.ratingIn && evidenceQuery.ratingIn.length > 0) {
    conditions.push(`rating IN (:ratingIn)`);
    replacements.ratingIn = evidenceQuery.ratingIn;
  }

  const [totalRow] = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".normalized_reviews WHERE ${conditions.join(" AND ")}`,
    { type: QueryTypes.SELECT, replacements },
  );

  const idRows = await appSequelize.query<{ canonical_review_id: string }>(
    `SELECT canonical_review_id FROM "${schema}".normalized_reviews
     WHERE ${conditions.join(" AND ")}
     ORDER BY review_date DESC, source_row_id DESC
     LIMIT ${MAX_EVIDENCE_REVIEW_IDS}`,
    { type: QueryTypes.SELECT, replacements },
  );

  return {
    canonicalReviewIds: idRows.map((r) => r.canonical_review_id),
    totalMatchingCount: Number(totalRow!.count),
    platform: evidenceQuery.platform,
    dateWindow: evidenceQuery.window,
    query: evidenceQuery.description,
  };
}
