/**
 * Phase 3 §12 — severity FOUNDATION only. No formula is chosen in Phase 3 —
 * this module exists so callers (health score, early warnings) have a
 * shared type to reference, and so FACT (inputs, deterministic) stays
 * structurally separate from INTERPRETATION (level, a business judgment call
 * this phase explicitly does not make).
 */
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SeverityAssessment {
  scopeType: "product" | "brand";
  scopeId: string;
  platform: string | null;
  level: SeverityLevel | null; // null — no formula approved yet, see above
  confidence: "high" | "medium" | "low" | "insufficient_data";
  inputs: {
    negativeReviewRate: number;
    ratingTrendDelta: number | null;
    complaintFrequency: number | null; // depends on review_theme having data — always null in Phase 3
    sampleSize: number;
  };
  evidenceReviewIds: string[];
  computedAt: Date;
  formulaVersion: "severity-v0-not-implemented";
}
