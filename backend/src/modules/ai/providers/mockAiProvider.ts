import { AiProviderError, type AiProvider } from "./aiProvider.js";
import type { AiAnalysisInput } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";
import { THEME_VOCABULARY } from "../../../database/appStore/models/reviewTheme.js";

/**
 * Phase 4 §11 — deterministic mock provider. The test suite never depends on
 * a real AI API: no network call, no cost, fully reproducible. Classification
 * is a simple deterministic function of the input (rating -> sentiment,
 * literal theme-keyword presence in the text -> themes), not random — the
 * same input always produces the same output, which is what makes
 * idempotency/staleness tests meaningful against it.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  readonly modelVersion = "mock-v1";

  private failuresRemaining = 0;

  /** Test hook (Phase 4 §22 items 17-19): makes the next N calls throw. */
  injectFailures(count: number): void {
    this.failuresRemaining = count;
  }

  async analyzeReview(input: AiAnalysisInput): Promise<unknown> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new AiProviderError(this.name, "injected failure for testing");
    }

    const label = input.rating >= 4 ? "positive" : input.rating === 3 ? "neutral" : "negative";
    const haystack = `${input.title ?? ""} ${input.reviewText ?? ""}`.toLowerCase();

    const themes = THEME_VOCABULARY.filter((theme) => haystack.includes(theme.replace("_", " ")))
      .slice(0, 5)
      .map((theme) => ({
        theme,
        confidence: 0.8,
        evidence: extractSnippet(haystack, theme.replace("_", " ")),
      }));

    return {
      sentiment: { label, confidence: 0.9 },
      themes,
    };
  }

  async narrate(evidencePackage: ProductEvidencePackage): Promise<unknown> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new AiProviderError(this.name, "injected failure for testing");
    }

    // Deterministic, and only ever cites IDs already present in the package
    // — a real provider might hallucinate one, which is exactly what
    // narrator.ts's validation step exists to catch; the mock never does,
    // by construction, so tests can specifically inject a bad ID to prove
    // the filtering logic (see aiNarrator.test.ts).
    //
    // Phase 4.1 remediation item 1 — citations are additionally filtered to
    // IDs the evidence package's reviewThemes mapping actually associates
    // with the claimed theme, so the mock stays a valid stand-in under
    // narrator.ts's citation-*relevance* check (not just ID-existence) —
    // this is what Step 10 of Phase 4.1 found real Gemini output fails to do
    // on its own; the mock is deliberately built to always get it right.
    const topNegative = evidencePackage.topNegativeThemes[0];
    const groundedIds = topNegative
      ? evidencePackage.evidenceReviewIds.filter((id) => (evidencePackage.reviewThemes[id] ?? []).includes(topNegative.theme)).slice(0, 3)
      : [];
    const hasGroundedEvidence = topNegative !== undefined && groundedIds.length > 0;

    return {
      summary: hasGroundedEvidence
        ? `Among the analyzed reviews, ${topNegative.theme} is the most common negative theme.`
        : "Reviews indicate no strong, evidence-grounded negative theme in the analyzed window.",
      rootCause: hasGroundedEvidence
        ? [
            {
              theme: topNegative.theme,
              explanation: `Reviews indicate ${topNegative.theme} concerns appear in ${topNegative.count} of the analyzed reviews.`,
              evidenceReviewIds: groundedIds,
            },
          ]
        : [],
      recommendations: hasGroundedEvidence
        ? [
            {
              reason: `The strongest observed complaint theme is ${topNegative.theme}.`,
              evidenceReviewIds: groundedIds,
              confidence: 0.7,
              theme: topNegative.theme,
            },
          ]
        : [],
    };
  }
}

function extractSnippet(text: string, keyword: string): string {
  const idx = text.indexOf(keyword);
  if (idx === -1) return keyword;
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + keyword.length + 20);
  return text.slice(start, end).trim();
}
