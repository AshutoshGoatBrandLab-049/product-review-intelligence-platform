/**
 * Phase 3 §14 — sample-size-aware confidence. Thresholds approved for Phase 3
 * (2026-08-12): configuration values, not hardcoded business truth — kept in
 * one named, exported constant so they can be tuned without touching any
 * calculation logic.
 */
export const CONFIDENCE_THRESHOLDS = {
  minReviewsForHighConfidence: 100,
  minReviewsForMediumConfidence: 20,
  minReviewsForLowConfidence: 5,
  // fewer than minReviewsForLowConfidence => "insufficient_data"
} as const;

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient_data";

export interface ConfidenceThresholds {
  minReviewsForHighConfidence: number;
  minReviewsForMediumConfidence: number;
  minReviewsForLowConfidence: number;
}

export function classifyConfidence(
  sampleSize: number,
  thresholds: ConfidenceThresholds = CONFIDENCE_THRESHOLDS,
): ConfidenceLevel {
  if (sampleSize >= thresholds.minReviewsForHighConfidence) return "high";
  if (sampleSize >= thresholds.minReviewsForMediumConfidence) return "medium";
  if (sampleSize >= thresholds.minReviewsForLowConfidence) return "low";
  return "insufficient_data";
}
