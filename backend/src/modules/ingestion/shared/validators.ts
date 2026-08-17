import type { Platform, UnifiedReview } from "../../../types/unifiedReview.js";

/**
 * Restricted, explicit allowlist for anything ever written to
 * ingestion_rejects.failed_fields — never a dump of the raw row. review_text
 * and author_name are structurally excluded: they are not members of this
 * type, so no validator can ever cause them to be stored, even by accident.
 */
export type FailedFieldKey =
  | "sourceProductId"
  | "sourceReviewId"
  | "rating"
  | "rawDateString"
  | "platform";

export type FailedFields = Partial<Record<FailedFieldKey, string | number | null>>;

export interface ValidationReject {
  outcome: "reject";
  reason:
    | "missing_product_id"
    | "missing_review_id"
    | "missing_rating"
    | "invalid_rating"
    | "invalid_date"
    | "invalid_platform";
  failedFields: FailedFields;
}

export interface ValidationFlag {
  outcome: "flag";
  flags: Array<"brand_missing" | "product_mapping_missing">;
}

export interface ValidationPass {
  outcome: "pass";
}

export type ValidationResult = ValidationReject | ValidationFlag | ValidationPass;

const VALID_PLATFORMS: readonly Platform[] = ["flipkart", "myntra"];

/**
 * Phase 2 §6 rules: hard-reject structurally unusable rows, pass-with-flag
 * for rows that are real and usable but missing non-identity metadata.
 * Never guesses a missing value — quarantine, never delete; flag, never guess.
 */
export function validateUnifiedReview(review: UnifiedReview): ValidationResult {
  if (!VALID_PLATFORMS.includes(review.platform)) {
    return {
      outcome: "reject",
      reason: "invalid_platform",
      failedFields: { platform: review.platform },
    };
  }

  if (!review.sourceProductId || review.sourceProductId.trim() === "") {
    return {
      outcome: "reject",
      reason: "missing_product_id",
      failedFields: { sourceProductId: review.sourceProductId, platform: review.platform },
    };
  }

  if (!review.sourceReviewId || review.sourceReviewId.trim() === "") {
    return {
      outcome: "reject",
      reason: "missing_review_id",
      failedFields: { sourceReviewId: review.sourceReviewId, platform: review.platform },
    };
  }

  if (review.rating === null || review.rating === undefined) {
    return {
      outcome: "reject",
      reason: "missing_rating",
      failedFields: { platform: review.platform },
    };
  }

  if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
    return {
      outcome: "reject",
      reason: "invalid_rating",
      failedFields: { rating: review.rating, platform: review.platform },
    };
  }

  if (!isValidReviewDate(review.reviewDate)) {
    return {
      outcome: "reject",
      reason: "invalid_date",
      failedFields: { rawDateString: review.reviewDate, platform: review.platform },
    };
  }

  const flags: ValidationFlag["flags"] = [];
  if (!review.brand || review.brand.trim() === "") {
    flags.push("brand_missing");
  }

  if (flags.length > 0) {
    return { outcome: "flag", flags };
  }

  return { outcome: "pass" };
}

function isValidReviewDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;

  const year = date.getUTCFullYear();
  const now = new Date();
  const maxYear = now.getUTCFullYear() + 1;
  return year >= 2007 && year <= maxYear;
}
