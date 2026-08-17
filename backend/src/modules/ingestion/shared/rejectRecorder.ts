import type { Transaction } from "sequelize";
import { appSequelize } from "../../../database/appStore/client.js";
import { config } from "../../../config/index.js";
import type { Platform } from "../../../types/unifiedReview.js";
import type { FailedFields, ValidationReject } from "./validators.js";

export interface RejectInput {
  platform: Platform;
  sourceRowId: number;
  sourceProductId: string | null;
  sourceReviewId: string | null;
  reason: ValidationReject["reason"];
  failedFields: FailedFields;
}

/**
 * Idempotent reject recording (Phase 2.1 §2) — replaces the previous
 * unconditional `IngestionReject.create(...)` call sites in trackA.ts /
 * trackB.ts, which created a brand-new row on every single observation of
 * the same invalid source row (Phase 2 §9b/§24 finding).
 *
 * Identity is (platform, source_row_id, reason) — enforced by migration 005's
 * unique constraint, not just application-level discipline. A raw
 * `INSERT ... ON CONFLICT ... DO UPDATE` is used rather than Sequelize's
 * findOrCreate/upsert helpers specifically so the occurrence_count increment
 * is atomic at the database level (`occurrence_count + 1`, not
 * read-then-write), safe even if two workers somehow observed the same bad
 * row concurrently (Phase 2.1 §2D Test 6).
 *
 * A source row that starts failing for a *different* reason gets its own
 * row — deliberately not merged into the old one, since that's meaningfully
 * new information (Phase 2.1 §2C, Test 4). If the row later becomes valid,
 * no further reject rows are written for it (the caller simply stops calling
 * this function for that row once validation passes) — the existing reject
 * row(s) remain as history, untouched.
 */
export async function recordReject(input: RejectInput, transaction?: Transaction): Promise<void> {
  const schema = config.appStore.schema;
  await appSequelize.query(
    `INSERT INTO "${schema}".ingestion_rejects
       (platform, source_row_id, source_product_id, source_review_id, reason, failed_fields, first_seen_at, last_seen_at, occurrence_count)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now(), 1)
     ON CONFLICT (platform, source_row_id, reason)
     DO UPDATE SET
       last_seen_at = now(),
       occurrence_count = "${schema}".ingestion_rejects.occurrence_count + 1,
       failed_fields = EXCLUDED.failed_fields,
       source_product_id = EXCLUDED.source_product_id,
       source_review_id = EXCLUDED.source_review_id`,
    {
      bind: [
        input.platform,
        input.sourceRowId,
        input.sourceProductId,
        input.sourceReviewId,
        input.reason,
        JSON.stringify(input.failedFields),
      ],
      transaction,
    },
  );
}
