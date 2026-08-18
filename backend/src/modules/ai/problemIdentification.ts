/**
 * Phase 10 Step 3 — Deterministic problem identification from evidence.
 * For TOP_PROBLEM and COMPLAINT_ANALYSIS intents, analyze the product evidence
 * to identify dominant issues, ties, or insufficient data.
 * This is the SOURCE OF TRUTH for what "the biggest issue" is.
 * AI only explains this result; does not decide it.
 */

import type { ProductEvidencePackage } from "./evidencePackage.js";

export enum ProblemIdentificationResult {
  CLEAR_DOMINANT = "CLEAR_DOMINANT",
  TIE = "TIE",
  INSUFFICIENT_DATA = "INSUFFICIENT_DATA",
  NO_NEGATIVE_EVIDENCE = "NO_NEGATIVE_EVIDENCE",
}

export interface IdentifiedProblem {
  result: ProblemIdentificationResult;
  /** The dominant theme if result is CLEAR_DOMINANT */
  dominantTheme?: string;
  /** The count for dominant theme */
  dominantThemeCount?: number;
  /** All themes if result is TIE */
  tiedThemes?: Array<{ theme: string; count: number }>;
  /** Why this result (for AI explanation) */
  explanation: string;
  /** Total negative reviews in window */
  negativeReviewCount: number;
  /** Review IDs supporting the identified problem */
  supportingReviewIds: string[];
}

/**
 * Identify the "biggest issue" deterministically from evidence package.
 * Used for TOP_PROBLEM and COMPLAINT_ANALYSIS intents.
 *
 * The logic:
 * 1. If no negative evidence, return NO_NEGATIVE_EVIDENCE
 * 2. If topNegativeThemes exists and clear winner, return CLEAR_DOMINANT
 * 3. If top themes tied, return TIE
 * 4. If insufficient theme data, return INSUFFICIENT_DATA
 *
 * This is deterministic. No LLM deciding "biggest".
 */
export function identifyDominantProblem(evidencePackage: ProductEvidencePackage): IdentifiedProblem {
  const negativeReviewCount = evidencePackage.totalMatchingNegativeCount;

  // No negative reviews at all
  if (negativeReviewCount === 0) {
    return {
      result: ProblemIdentificationResult.NO_NEGATIVE_EVIDENCE,
      explanation: "No negative reviews (rating ≤ 2) found in this time period.",
      negativeReviewCount: 0,
      supportingReviewIds: [],
    };
  }

  // Check if we have theme data
  if (!evidencePackage.topNegativeThemes || evidencePackage.topNegativeThemes.length === 0) {
    return {
      result: ProblemIdentificationResult.INSUFFICIENT_DATA,
      explanation: "No theme data available to identify specific issues. Negative reviews exist but themes are not yet classified.",
      negativeReviewCount,
      supportingReviewIds: evidencePackage.evidenceReviewIds,
    };
  }

  const topTheme = evidencePackage.topNegativeThemes[0];
  if (!topTheme) {
    // No theme data despite negative reviews
    return {
      result: ProblemIdentificationResult.INSUFFICIENT_DATA,
      explanation: "Negative reviews exist but no theme data is available to identify specific issues.",
      negativeReviewCount,
      supportingReviewIds: evidencePackage.evidenceReviewIds,
    };
  }

  const secondTheme = evidencePackage.topNegativeThemes[1];

  // Check for tie at the top
  if (secondTheme && topTheme.count === secondTheme.count) {
    // Tied themes — collect all with the same count as top
    const tiedCount = topTheme.count;
    const allTied = evidencePackage.topNegativeThemes.filter((t) => t.count === tiedCount);

    return {
      result: ProblemIdentificationResult.TIE,
      tiedThemes: allTied,
      explanation: `Multiple issues are tied as the most frequently observed complaints: ${allTied.map((t) => t.theme).join(", ")}. The available data does not identify one dominant issue.`,
      negativeReviewCount,
      supportingReviewIds: evidencePackage.evidenceReviewIds,
    };
  }

  // Clear dominant theme
  return {
    result: ProblemIdentificationResult.CLEAR_DOMINANT,
    dominantTheme: topTheme.theme,
    dominantThemeCount: topTheme.count,
    explanation: `The dominant identified issue is ${topTheme.theme}. This theme appears most frequently among negative reviews in this time period (${topTheme.count} mention(s)).`,
    negativeReviewCount,
    supportingReviewIds: evidencePackage.evidenceReviewIds,
  };
}

/**
 * For COMPLAINT_ANALYSIS, return all significant complaint themes ranked by frequency.
 */
export function analyzeComplaints(
  evidencePackage: ProductEvidencePackage,
): { themes: Array<{ theme: string; count: number; percentage: number }>; totalNegativeReviews: number } {
  const negCount = evidencePackage.totalMatchingNegativeCount;

  if (negCount === 0 || !evidencePackage.topNegativeThemes) {
    return {
      themes: [],
      totalNegativeReviews: negCount,
    };
  }

  return {
    themes: evidencePackage.topNegativeThemes.map((t) => ({
      theme: t.theme,
      count: t.count,
      percentage: negCount > 0 ? (t.count / negCount) * 100 : 0,
    })),
    totalNegativeReviews: negCount,
  };
}

/**
 * For POSITIVE_FEEDBACK, return positive themes ranked by frequency.
 */
export function analyzePositiveFeedback(
  evidencePackage: ProductEvidencePackage,
): { themes: Array<{ theme: string; count: number; percentage: number }>; totalReviews: number } {
  const totalCount = evidencePackage.reviewCount;

  if (totalCount === 0 || !evidencePackage.topThemes) {
    return {
      themes: [],
      totalReviews: totalCount,
    };
  }

  return {
    themes: evidencePackage.topThemes.map((t) => ({
      theme: t.theme,
      count: t.count,
      percentage: totalCount > 0 ? (t.count / totalCount) * 100 : 0,
    })),
    totalReviews: totalCount,
  };
}
