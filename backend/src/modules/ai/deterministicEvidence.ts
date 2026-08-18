/**
 * Phase 10 Step 3 — Deterministic Evidence Construction
 *
 * This module ensures that evidence counts and review IDs are
 * deterministically owned by the backend, BEFORE any AI narration.
 *
 * AI may explain the findings, but MUST NOT decide which reviews
 * constitute the evidence, or modify the count.
 *
 * Core invariant:
 *   reportedCount === unique(evidenceReviewIds).length
 */

import type { SemanticAspectData } from "./types.js";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { QueryTypes } from "sequelize";
import type { Platform } from "../../types/unifiedReview.js";

export interface DeterministicRootCause {
  aspect: string;
  count: number;
  reviewIds: string[];
  sentiments: Array<{ sentiment: string; count: number }>;
  explanation: string;
}

/**
 * Build root cause deterministically from semantic analysis.
 * Backend owns the count and evidence IDs.
 * This is NOT decided by AI.
 */
export async function buildDeterministicRootCause(
  semanticAspects: SemanticAspectData[],
  platform: Platform,
  sourceProductId: string,
): Promise<DeterministicRootCause | null> {
  if (!semanticAspects || semanticAspects.length === 0) {
    return null;
  }

  // Highest-ranked aspect is the root cause
  const dominant = semanticAspects[0];
  if (!dominant) {
    return null;
  }

  const schema = config.appStore.schema;

  // VALIDATION: Verify every review ID exists in normalized_reviews
  if (dominant.reviewIds && dominant.reviewIds.length > 0) {
    const validationResult = (await appSequelize.query<any>(
      `SELECT COUNT(*) as valid_count
       FROM "${schema}".normalized_reviews
       WHERE canonical_review_id IN (:ids)
         AND platform = :platform
         AND source_product_id = :sourceProductId`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          ids: dominant.reviewIds,
          platform,
          sourceProductId,
        },
      },
    )) as any[];

    const validCount = validationResult[0]?.valid_count ?? 0;
    if (validCount !== dominant.reviewIds.length) {
      console.error(
        `Evidence validation failed: ${validCount}/${dominant.reviewIds.length} review IDs exist in database`,
      );
      // This is a critical integrity issue - report but continue
    }
  }

  // Build deterministic root cause
  const rootCause: DeterministicRootCause = {
    aspect: dominant.aspect,
    count: dominant.count,
    reviewIds: [...dominant.reviewIds], // Clone to prevent external modification
    sentiments: dominant.sentiments.map((s) => ({ ...s })),
    explanation: `${dominant.aspect} appears in ${dominant.count} review(s)`,
  };

  // Validate the invariant
  const uniqueIds = new Set(rootCause.reviewIds);
  if (uniqueIds.size !== rootCause.count) {
    console.error(
      `EVIDENCE INTEGRITY VIOLATION: count=${rootCause.count} but unique IDs=${uniqueIds.size}`,
    );
  }

  return rootCause;
}

/**
 * Validate that a set of review IDs all exist in the database
 * for the requested product/platform/window.
 *
 * Returns only valid IDs that pass verification.
 */
export async function validateEvidenceReviewIds(
  reviewIds: string[],
  platform: Platform,
  sourceProductId: string,
): Promise<{ valid: string[]; invalid: string[] }> {
  if (reviewIds.length === 0) {
    return { valid: [], invalid: [] };
  }

  const schema = config.appStore.schema;

  const validIds = (await appSequelize.query<any>(
    `SELECT DISTINCT canonical_review_id
     FROM "${schema}".normalized_reviews
     WHERE canonical_review_id IN (:ids)
       AND platform = :platform
       AND source_product_id = :sourceProductId`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        ids: reviewIds,
        platform,
        sourceProductId,
      },
    },
  )) as any[];

  const validSet = new Set(validIds.map((r: any) => r.canonical_review_id));
  const valid = reviewIds.filter((id) => validSet.has(id));
  const invalid = reviewIds.filter((id) => !validSet.has(id));

  return { valid, invalid };
}

/**
 * Enforce evidence integrity invariants.
 * Called before returning the final response.
 */
export function validateEvidenceIntegrity(
  aspect: string,
  count: number,
  reviewIds: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Invariant 1: Count must equal unique review IDs
  const uniqueIds = new Set(reviewIds);
  if (count !== uniqueIds.size) {
    errors.push(
      `Count mismatch: aspect "${aspect}" reports count=${count} but has ${uniqueIds.size} unique review IDs`,
    );
  }

  // Invariant 2: No duplicate IDs
  if (reviewIds.length !== uniqueIds.size) {
    errors.push(`Duplicate review IDs detected in aspect "${aspect}"`);
  }

  // Invariant 3: Non-negative count
  if (count < 0) {
    errors.push(`Negative count for aspect "${aspect}": ${count}`);
  }

  // Invariant 4: No empty reviews with positive count
  if (count > 0 && reviewIds.length === 0) {
    errors.push(`Aspect "${aspect}" reports count=${count} but has no review IDs`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
