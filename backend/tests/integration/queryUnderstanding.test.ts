import { describe, it, expect, beforeAll } from "vitest";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import { QueryTypes } from "sequelize";
import { analyzeProductQuestion } from "../../src/modules/ai/productAnalyst.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { getOrCreateConversation } from "../../src/modules/ai/conversationStore.js";
import type { Platform } from "../../src/types/unifiedReview.js";

/**
 * Phase 10 query-understanding correction — integration tests against the
 * real local dev DB (MockAiProvider, no network calls). Covers spec items
 * this round adds real behavior for, not just internal classification:
 *   - item 3: a resolved timeframe ("last N days") actually narrows the
 *     window passed to retrieveReviews(), not just the classifier's output.
 *   - item 4: RECOMMEND_IMPROVEMENTS produces a response distinct from the
 *     generic stats-leaning narrator path.
 *   - item 7: a context-resolved "show me" after an analysis turn retrieves
 *     reviews FOR that turn's aspect, not generic latest reviews — walked as
 *     a real two-turn conversation, not asserted in isolation.
 */

let product: { platform: Platform; source_product_id: string };

beforeAll(async () => {
  // A product with >1 review and at least one negative (rating<=2) review,
  // so semantic analysis has something to find an aspect for.
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

describe("query-understanding correction — real timeframe narrows the actual DB query", () => {
  it("'last 5 days' returns totalMatchingCount <= the 30d window's count for the same product", async () => {
    const provider = new MockAiProvider();

    const wide = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "show me all the reviews", window: "30d" },
      provider,
    );
    const narrow = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "show me last 5 days reviews" },
      provider,
    );

    expect(Array.isArray(narrow.reviews)).toBe(true);
    expect(narrow.totalMatchingCount ?? 0).toBeLessThanOrEqual(wide.totalMatchingCount ?? 0);
    // The resolved window actually changed — not silently ignored.
    expect(narrow.window).not.toEqual(wide.window);

    // Every returned review, if any, must fall inside the narrowed window in the DB.
    for (const review of narrow.reviews ?? []) {
      const rows = (await appSequelize.query(
        `SELECT review_date FROM "${config.appStore.schema}".normalized_reviews
         WHERE canonical_review_id = :id AND platform = :platform AND source_product_id = :pid`,
        { replacements: { id: review.canonicalReviewId, platform: product.platform, pid: product.source_product_id }, type: QueryTypes.SELECT },
      )) as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].review_date >= narrow.window.start).toBe(true);
      expect(rows[0].review_date <= narrow.window.end).toBe(true);
    }
  });
});

describe("query-understanding correction — RECOMMEND_IMPROVEMENTS is a distinct response", () => {
  it("'how can improve this product' does not fall through to a generic stats answer", async () => {
    const provider = new MockAiProvider();
    const response = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "how can improve this product", window: "12m" },
      provider,
    );

    // Must not silently degrade to the STATS_QUERY shape (reviewCount/averageRating-led prose).
    expect(response.answer.toLowerCase()).not.toMatch(/^\d+ reviews?, average rating/);
    // If evidence-grounded, the mock provider's RECOMMENDATION branch leads with "Customers report" + "Recommended action".
    if ((response.analysis?.rootCause?.length ?? 0) > 0) {
      expect(response.answer.toLowerCase()).toContain("recommend");
    }
  });
});

describe("query-understanding correction — conversational context resolves 'show me' to the prior aspect", () => {
  it("walks a real two-turn conversation: analysis turn then 'show me' retrieves reviews FOR that aspect", async () => {
    const provider = new MockAiProvider();
    const conversation = await getOrCreateConversation(product.platform, product.source_product_id, { start: "2000-01-01", end: "2100-01-01" });

    const turn1 = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "What's the biggest issue?", conversationId: conversation.id, window: "12m" },
      provider,
    );
    const aspect = turn1.analysis?.rootCause?.[0]?.theme;

    const turn2 = await analyzeProductQuestion(
      { platform: product.platform, sourceProductId: product.source_product_id, userQuestion: "show me", conversationId: conversation.id, window: "12m" },
      provider,
    );

    expect(Array.isArray(turn2.reviews)).toBe(true);

    const turn1EvidenceIds = turn1.analysis?.rootCause?.[0]?.evidenceReviewIds ?? [];
    if (aspect && turn1EvidenceIds.length > 0) {
      // "show me" must resolve to REVIEWS FOR that aspect — the exact,
      // already-validated evidence-review-ID set the analysis turn cited —
      // not just "some reviews" per spec item 7. This is checked via the
      // real evidence IDs rather than the review_theme DB column, because a
      // semantically-discovered aspect (e.g. mock's "quality_issue") is
      // never persisted to review_theme (scoped to THEME_VOCABULARY only).
      const turn2Ids = (turn2.reviews ?? []).map((r) => r.canonicalReviewId);
      expect(turn2Ids.length).toBeGreaterThan(0);
      for (const id of turn2Ids) {
        expect(turn1EvidenceIds).toContain(id);
      }
    }
  });
});




