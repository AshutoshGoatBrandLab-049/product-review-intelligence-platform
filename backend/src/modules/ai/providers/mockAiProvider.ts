import { AiProviderError, type AiProvider } from "./aiProvider.js";
import type { AiAnalysisInput, ReviewWithText } from "../types.js";
import type { ProductEvidencePackage } from "../evidencePackage.js";
import { THEME_VOCABULARY } from "../../../database/appStore/models/reviewTheme.js";
import { AnalyticalIntent } from "../intentDetection.js";
import { resolveQuery, actionToIntent, type QueryAction } from "../queryResolution.js";
import type { QueryResolutionInput } from "../queryUnderstanding.js";
import type { PlannerInput } from "../semanticPlanner.js";

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

  async narrate(
    evidencePackage: ProductEvidencePackage,
    userQuestion?: string,
    analyticalIntent?: AnalyticalIntent,
  ): Promise<unknown> {
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
    // Phase 10 query-understanding correction, item 4 — RECOMMENDATION gets a
    // real, distinct response construction: prefer the semantic-analysis
    // discovered aspect (real customer-voiced text, not a fixed-vocabulary
    // label) when available, and lead `summary` with the recommended action,
    // not with reviewCount/averageRating statistics.
    const semanticAnalysis = (evidencePackage as any).semanticAnalysis;
    const topSemanticAspect = semanticAnalysis?.aspects?.[0];
    const topNegative = evidencePackage.topNegativeThemes[0];

    if (analyticalIntent === AnalyticalIntent.RECOMMENDATION) {
      const aspectName = topSemanticAspect?.aspect ?? topNegative?.theme;
      const aspectCount = topSemanticAspect?.count ?? topNegative?.count ?? 0;
      const groundedForRecommendation = aspectName
        ? evidencePackage.evidenceReviewIds
            .filter((id) => (evidencePackage.reviewThemes[id] ?? []).includes(aspectName))
            .slice(0, 3)
        : [];

      if (aspectName && groundedForRecommendation.length > 0) {
        return {
          summary:
            `Customers report ${aspectName} as a recurring concern (${aspectCount} review(s)). ` +
            `Recommended action: prioritize fixing ${aspectName} before other changes, since it is the most evidence-supported complaint in this window.`,
          rootCause: [
            {
              theme: aspectName,
              explanation: `Reviews indicate ${aspectName} concerns appear in ${aspectCount} of the analyzed reviews.`,
              evidenceReviewIds: groundedForRecommendation,
            },
          ],
          recommendations: [
            {
              reason: `Address ${aspectName} directly — this is the dominant, evidence-grounded customer complaint.`,
              evidenceReviewIds: groundedForRecommendation,
              confidence: 0.75,
              theme: aspectName,
            },
          ],
        };
      }

      return {
        summary: "No evidence-grounded complaint theme was found to base a specific recommendation on in this window.",
        rootCause: [],
        recommendations: [],
      };
    }

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

  /**
   * Phase 10 semantic-query-understanding — best-effort mock resolver, for
   * DETERMINISTIC-PIPELINE unit tests only (schema validation, timeframe-
   * descriptor -> DateWindow conversion, fallback-triggering, downstream
   * data execution given a FIXED resolved query). This delegates to the
   * SAME deterministic regex resolver (queryResolution.ts's resolveQuery())
   * that the real LLM path falls back to — it is not an independent
   * semantic model, and by construction cannot prove generalization to a
   * paraphrase its own rules don't already cover. It exists only so
   * MockAiProvider satisfies the AiProvider interface and the deterministic
   * parts of the pipeline can be unit-tested without a network call. Real
   * semantic-generalization proof requires the real provider — see
   * tests/real-provider/semanticQueryUnderstanding.real.test.ts.
   */
  async resolveQuery(input: QueryResolutionInput): Promise<unknown> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new AiProviderError(this.name, "injected failure for testing");
    }

    const lastAction = input.conversationContext.lastAction as QueryAction | null;
    const priorContext = lastAction
      ? {
          intent: actionToIntent(lastAction) ?? AnalyticalIntent.STATS_QUERY,
          aspect: input.conversationContext.lastAspect ?? undefined,
          reviewIds: input.conversationContext.lastReviewIds ?? undefined,
        }
      : undefined;

    const rq = resolveQuery(input.userQuestion, priorContext);

    return {
      action: rq.action,
      // Round-tripped as ABSOLUTE start/end regardless of the deterministic
      // resolver's original type — customWindow() just validates and
      // returns {start, end}, so this reproduces the exact same window
      // without needing to re-derive a NAMED `name` the schema would
      // otherwise lose (e.g. "last week"/"this month").
      timeframeDescriptor: rq.timeframe
        ? { type: "ABSOLUTE", start: rq.timeframe.window.start, end: rq.timeframe.window.end }
        : { type: "NONE" },
      sentiment: rq.sentiment,
      quantity: rq.quantity,
      aspect: rq.aspect,
      contextReference: rq.contextReference,
      responseStyle: rq.responseStyle,
      reasoning: "mock-provider: delegated to the deterministic regex resolver (not semantic understanding)",
    };
  }

  async analyzeReviewBatch(reviews: ReviewWithText[], prompt: string): Promise<unknown> {
    // Deterministic mock batch analysis
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new AiProviderError(this.name, "injected failure for testing");
    }

    // Mock semantic analysis: identify aspects based on keywords
    return reviews.map((review) => ({
      canonicalReviewId: review.canonical_review_id,
      observations:
        review.review_text && review.review_text.length > 0
          ? [
              {
                aspect: review.rating <= 2 ? "quality_issue" : "positive_feature",
                sentiment: review.rating <= 2 ? "negative" : "positive",
                textSnippet: review.review_text.slice(0, 50),
                confidence: 0.8,
                sourceModel: "mock-v1",
              },
            ]
          : [],
    }));
  }

  /**
   * Phase 10 PHASE B mock — deterministic operation planner for tests.
   * Creates simple plans for common patterns using the existing deterministic
   * resolver as a guide. This is NOT semantic AI — it's a rule-based dispatcher
   * like queryResolution.ts, intended only for unit test stability.
   * Real semantic proof requires real provider — see real-provider tests.
   */
  async planOperations(input: PlannerInput): Promise<unknown> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new AiProviderError(this.name, "injected failure for testing");
    }

    const q = input.userQuestion.toLowerCase();

    // Simple pattern matching for deterministic mock plans
    // (Real planner uses semantic understanding; this is just for test scaffolding)

    // Pattern: retrieval + analysis (e.g., "show me bad reviews and tell me what's wrong")
    if ((q.includes("show") || q.includes("get")) && (q.includes("tell") || q.includes("what"))) {
      const sentiment = q.includes("bad") || q.includes("negative") ? "negative" : q.includes("good") ? "positive" : undefined;
      const params0: any = {
        timeframeDescriptor: { type: "NAMED", name: "7d" },
      };
      const params1: any = {};
      if (sentiment) {
        params0.sentiment = sentiment;
        params1.sentiment = sentiment;
      }
      return {
        goal: "Retrieve reviews and analyze them",
        operations: [
          {
            id: "op_0",
            type: "RETRIEVE_REVIEWS",
            params: params0,
          },
          {
            id: "op_1",
            type: "ANALYZE_REVIEW_SET",
            params: params1,
            dependsOn: "op_0",
          },
        ],
        resultOperationId: "op_1",
        contextReference: false,
        confidence: "high",
        reasoning: "Mock planner: matched retrieval+analysis pattern",
      };
    }

    // Pattern: simple retrieval (e.g., "show me reviews", "latest reviews")
    if (q.includes("show") || q.includes("get") || q.includes("latest") || q.includes("reviews")) {
      const sentiment = q.includes("bad") ? "negative" : q.includes("good") ? "positive" : undefined;
      const params: any = {
        timeframeDescriptor: { type: "NAMED", name: "7d" },
      };
      if (sentiment) {
        params.sentiment = sentiment;
      }
      return {
        goal: "Retrieve reviews",
        operations: [
          {
            id: "op_0",
            type: "RETRIEVE_REVIEWS",
            params,
          },
        ],
        resultOperationId: "op_0",
        contextReference: false,
        confidence: "high",
        reasoning: "Mock planner: matched retrieval pattern",
      };
    }

    // Pattern: analysis only (e.g., "what's wrong", "biggest issue", "why")
    if (q.includes("what") || q.includes("why") || q.includes("problem") || q.includes("issue") || q.includes("complaint")) {
      return {
        goal: "Analyze reviews",
        operations: [
          {
            id: "op_0",
            type: "ANALYZE_REVIEW_SET",
            params: {},
          },
        ],
        resultOperationId: "op_0",
        contextReference: false,
        confidence: "medium",
        reasoning: "Mock planner: matched analysis pattern",
      };
    }

    // Fallback: general assessment
    return {
      goal: input.userQuestion,
      operations: [
        {
          id: "op_0",
          type: "GENERAL_ASSESSMENT",
          params: {
            timeframeDescriptor: { type: "NAMED", name: "7d" },
          },
        },
      ],
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "low",
      reasoning: "Mock planner: fallback to general assessment",
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
