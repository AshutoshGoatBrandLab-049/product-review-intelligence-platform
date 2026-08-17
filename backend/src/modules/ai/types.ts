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
