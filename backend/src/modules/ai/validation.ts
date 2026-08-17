import { AiAnalysisOutputSchema, type AiAnalysisOutput } from "./types.js";

export type AiValidationResult =
  | { valid: true; data: AiAnalysisOutput }
  | { valid: false; errors: string[] };

/**
 * Phase 4 §6/§14/§15 — schema validation. AI output → this → business
 * validation (below) → database. Never AI output straight to a table.
 * Malformed responses are rejected outright, never silently coerced.
 */
export function validateAiOutput(raw: unknown): AiValidationResult {
  const result = AiAnalysisOutputSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }

  const deduped = dedupeThemes(result.data.themes);
  return { valid: true, data: { ...result.data, themes: deduped } };
}

/**
 * Phase 4 §3 — "do not duplicate identical (canonical_review_id, theme)
 * pairs." The DB's UNIQUE constraint is the hard backstop, but a
 * well-behaved pipeline shouldn't even attempt the duplicate insert — if a
 * provider response names the same theme twice, keep the higher-confidence
 * observation rather than erroring the whole review out.
 */
export function dedupeThemes(
  themes: AiAnalysisOutput["themes"],
): AiAnalysisOutput["themes"] {
  const byTheme = new Map<string, AiAnalysisOutput["themes"][number]>();
  for (const t of themes) {
    const existing = byTheme.get(t.theme);
    if (!existing || t.confidence > existing.confidence) {
      byTheme.set(t.theme, t);
    }
  }
  return [...byTheme.values()];
}

export interface FreshnessCheck {
  currentContentHash: string;
  hashBeingWritten: string;
}

/**
 * Phase 4 §7/§14 — refuses to persist a classification computed against a
 * stale snapshot of the review as if it were current. If the review's
 * content_hash changed between when the candidate was selected and when the
 * result is about to be written (e.g. a concurrent Track B update), the
 * write is rejected — the review simply becomes a candidate again on the
 * next run, rather than silently recording a classification of content that
 * no longer exists.
 */
export function isFreshEnoughToWrite(check: FreshnessCheck): boolean {
  return check.currentContentHash === check.hashBeingWritten;
}
