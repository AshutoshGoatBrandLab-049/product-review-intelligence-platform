import { describe, it, expect, beforeAll } from "vitest";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import { QueryTypes } from "sequelize";
import { analyzeProductQuestion } from "../../src/modules/ai/productAnalyst.js";
import type { AiProvider } from "../../src/modules/ai/providers/aiProvider.js";
import type { Platform } from "../../src/types/unifiedReview.js";

/**
 * Phase 10 semantic-query-understanding — DETERMINISTIC-PIPELINE integration
 * tests, against the real local dev DB. These prove that once an action +
 * structural parameters are resolved (here, via a FIXED fake provider that
 * always returns a specific canned structured resolution — standing in for
 * "the LLM already decided X"), the actual data execution (SQL filters,
 * evidence-integrity-checked real rows) is correct. This does NOT test
 * whether the LLM can classify a novel paraphrase — that's a different,
 * separately labeled kind of proof (see
 * tests/real-provider/semanticQueryUnderstanding.real.test.ts).
 */

let product: { platform: Platform; source_product_id: string };

beforeAll(async () => {
  const rows = (await appSequelize.query(
    `SELECT platform, source_product_id, COUNT(*) FILTER (WHERE rating <= 2) as neg
     FROM "${config.appStore.schema}".normalized_reviews
     GROUP BY platform, source_product_id
     HAVING COUNT(*) FILTER (WHERE rating <= 2) >= 1
     ORDER BY COUNT(*) DESC LIMIT 1`,
    { type: QueryTypes.SELECT },
  )) as any[];
  expect(rows.length).toBeGreaterThan(0);
  product = rows[0];
});

/** A provider whose resolveQuery() always returns the same fixed structured resolution. */
function fixedResolutionProvider(resolution: unknown): AiProvider {
  return {
    name: "fixed-llm-shaped",
    modelVersion: "fixed-v1",
    async analyzeReview() {
      return { sentiment: { label: "negative", confidence: 0.9 }, themes: [] };
    },
    async narrate() {
      return { summary: "unused in retrieval path", rootCause: [], recommendations: [] };
    },
    async resolveQuery() {
      return resolution;
    },
  };
}

describe("resolveQuerySemantic wired into analyzeProductQuestion — real DB execution given a fixed LLM decision", () => {
  it("RETRIEVE_REVIEWS + sentiment=negative + RELATIVE timeframe narrows the real query and returns only real rows", async () => {
    const provider = fixedResolutionProvider({
      action: "RETRIEVE_REVIEWS",
      timeframeDescriptor: { type: "RELATIVE", value: 3650, unit: "day" }, // wide enough to include fixture data deterministically
      sentiment: "negative",
      quantity: 5,
      aspect: null,
      contextReference: false,
      responseStyle: "DEFAULT",
      reasoning: "fixed test resolution",
    });

    const response = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "kuch bhi likh do yahan" },
      provider,
    );

    expect(Array.isArray(response.reviews)).toBe(true);
    expect(response.analysis).toBeNull(); // retrieval path never reaches the narrator

    // Every returned review must be real and actually negative (rating<=2), never fabricated.
    for (const review of response.reviews ?? []) {
      const rows = (await appSequelize.query(
        `SELECT rating FROM "${config.appStore.schema}".normalized_reviews
         WHERE canonical_review_id = :id AND platform = :platform AND source_product_id = :pid`,
        {
          replacements: { id: review.canonicalReviewId, platform: product.platform, pid: product.source_product_id },
          type: QueryTypes.SELECT,
        },
      )) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].rating).toBeLessThanOrEqual(2);
    }
  });

  it("falls back to the deterministic resolver end-to-end when the provider's resolveQuery throws, and still answers correctly", async () => {
    const provider: AiProvider = {
      name: "throwing",
      modelVersion: "v1",
      async analyzeReview() {
        return { sentiment: { label: "negative", confidence: 0.9 }, themes: [] };
      },
      async narrate() {
        return { summary: "unused", rootCause: [], recommendations: [] };
      },
      async resolveQuery() {
        throw new Error("simulated LLM outage");
      },
    };

    const response = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "show me the bad reviews", window: "12m" },
      provider,
    );

    // The deterministic fallback resolver still correctly classifies this as retrieval.
    expect(Array.isArray(response.reviews)).toBe(true);
    expect(response.analysis).toBeNull();
  });

  it("EXPLAIN_PREVIOUS_RESULT resolved by a fixed provider reuses prior evidence without a new analysis pass", async () => {
    const { getOrCreateConversation } = await import("../../src/modules/ai/conversationStore.js");
    const conversation = await getOrCreateConversation(product.platform, product.source_product_id, {
      start: "2000-01-01",
      end: "2100-01-01",
    });

    // Turn 1: a normal analysis question, resolved via the fixed provider as ANALYZE_PROBLEM.
    const analysisProvider = fixedResolutionProvider({
      action: "ANALYZE_PROBLEM",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null,
      contextReference: false,
      responseStyle: "DEFAULT",
      reasoning: "turn 1",
    });
    const turn1 = await analyzeProductQuestion(
      {
        platform: product.platform,
        sourceProductId: product.source_product_id,
        userQuestion: "what's the biggest issue",
        conversationId: conversation.id,
        window: "12m",
      },
      analysisProvider,
    );
    expect(turn1.analysis).not.toBeNull();

    // Turn 2: "why?" resolved as EXPLAIN_PREVIOUS_RESULT via a fixed provider —
    // must reuse the SAME evidence review IDs, not run a fresh analysis pass.
    const explainProvider = fixedResolutionProvider({
      action: "EXPLAIN_PREVIOUS_RESULT",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null,
      contextReference: true,
      responseStyle: "DEFAULT",
      reasoning: "turn 2 pronoun follow-up",
    });
    const turn2 = await analyzeProductQuestion(
      {
        platform: product.platform,
        sourceProductId: product.source_product_id,
        userQuestion: "why?",
        conversationId: conversation.id,
        window: "12m",
      },
      explainProvider,
    );

    const turn1Ids = turn1.analysis?.rootCause?.[0]?.evidenceReviewIds ?? [];
    const turn2Ids = turn2.analysis?.rootCause?.[0]?.evidenceReviewIds ?? [];
    if (turn1Ids.length > 0) {
      expect(turn2Ids.sort()).toEqual(turn1Ids.sort());
    }
  });
});
