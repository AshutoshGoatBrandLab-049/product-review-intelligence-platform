import { z } from "zod";
import { THEME_VOCABULARY } from "../../database/appStore/models/reviewTheme.js";

/**
 * Phase 4 §6 — strict structured AI output. This is the ONLY shape ever
 * accepted from a provider; free-form prose is never parsed. AI output goes
 * through this schema, then business validation (validation.ts), before it
 * can reach the database — never AI output straight to a table.
 */
export const SENTIMENT_LABELS = ["positive", "neutral", "negative"] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

export const AiAnalysisOutputSchema = z.object({
  sentiment: z.object({
    label: z.enum(SENTIMENT_LABELS),
    confidence: z.number().min(0).max(1),
  }),
  themes: z
    .array(
      z.object({
        theme: z.enum(THEME_VOCABULARY),
        confidence: z.number().min(0).max(1),
        // Bounded — a pointer for a human/AI narrator, never a duplicate of
        // the full review body (Phase 3 §11 design, carried forward).
        evidence: z.string().min(1).max(300),
      }),
    )
    .max(5),
});

export type AiAnalysisOutput = z.infer<typeof AiAnalysisOutputSchema>;

export interface AiAnalysisInput {
  canonicalReviewId: string;
  rating: number;
  title: string | null;
  reviewText: string | null;
}

/**
 * Phase 10 Step 3 — Semantic Analysis types for dynamic review-text intelligence.
 * AI extracts customer-voiced aspects from actual review text, not limited to
 * pre-computed review_theme vocabulary.
 */
export type AspectSentiment = "positive" | "negative" | "neutral";

export interface SemanticAspectObservation {
  /**
   * Customer-voiced aspect (not from fixed vocabulary).
   * Examples: "material_quality", "delivery_time", "sizing", "durability"
   */
  aspect: string;

  /**
   * Sentiment specific to this aspect, not inherited from review-level sentiment.
   */
  sentiment: AspectSentiment;

  /**
   * Actual text snippet from review supporting this observation.
   */
  textSnippet: string;

  /**
   * Model confidence in this extraction (0-1).
   * < 0.5 indicates low confidence; marked but included.
   */
  confidence: number;

  /**
   * Which model extracted this (for traceability).
   */
  sourceModel: string;
}

export interface ReviewSemanticAnalysis {
  canonicalReviewId: string;
  platform: string;
  sourceProductId: string;

  /**
   * Multiple aspect observations from this one review.
   * Same review counted once per aspect, not multiple times.
   */
  observations: SemanticAspectObservation[];

  /**
   * When this analysis was performed.
   */
  analyzedAt: Date;

  /**
   * Hash of review_text when analyzed (for cache invalidation if text changes).
   * Populated if caching is added later.
   */
  reviewTextHash?: string;
}

export interface SemanticAspectData {
  /**
   * The discovered aspect name.
   */
  aspect: string;

  /**
   * Unique review count supporting this aspect.
   */
  count: number;

  /**
   * Percentage of total reviews.
   */
  percentage: number;

  /**
   * Canonical review IDs supporting this aspect.
   */
  reviewIds: string[];

  /**
   * Per-sentiment breakdown for this aspect.
   */
  sentiments: Array<{
    sentiment: AspectSentiment;
    count: number;
  }>;

  /**
   * True if this aspect has both positive and negative mentions.
   */
  hasConflictingSentiment?: boolean;
}

export interface ReviewWithText {
  canonical_review_id: string;
  platform: string;
  source_product_id: string;
  rating: number;
  review_text: string | null;
  title: string | null;
}
