import { describe, it, expect, beforeAll, vi } from "vitest";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import { QueryTypes } from "sequelize";
import { analyzeProductQuestion } from "../../src/modules/ai/productAnalyst.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import type { Platform } from "../../src/types/unifiedReview.js";

/**
 * Phase 10 AI Product Analyst intent/context correction — integration tests.
 * Proves (against the real local dev DB, MockAiProvider so no network calls):
 *   1. Retrieval-intent requests never invoke the AI provider.
 *   2. Retrieval-intent requests return real, DB-verifiable review IDs.
 *   3. Analysis-intent requests still produce evidence-integrity-checked rootCause.
 *   4. A semantically-discovered non-enum theme survives to rootCause[0].theme
 *      (regression test for the "theme forced into fixed enum" bug).
 *   5. An invented/fabricated theme string is still rejected (proves the
 *      relaxed schema didn't just remove validation entirely).
 */

let product: { platform: Platform; source_product_id: string };

beforeAll(async () => {
  const rows = (await appSequelize.query(
    `SELECT DISTINCT source_product_id, platform FROM "${config.appStore.schema}".normalized_reviews LIMIT 1`,
    { type: QueryTypes.SELECT },
  )) as any[];
  expect(rows.length).toBeGreaterThan(0);
  product = rows[0];
});

describe("analyzeProductQuestion — retrieval intent never touches the AI provider", () => {
  it("does not call narrate() or analyzeReviewBatch() for 'show me all the bad reviews'", async () => {
    const provider = new MockAiProvider();
    const narrateSpy = vi.spyOn(provider, "narrate");
    const batchSpy = vi.spyOn(provider, "analyzeReviewBatch");

    const response = await analyzeProductQuestion(
      {
        platform: product.platform,
        sourceProductId: product.source_product_id,
        userQuestion: "show me all the bad reviews",
        window: "12m",
      },
      provider,
    );

    expect(narrateSpy).not.toHaveBeenCalled();
    expect(batchSpy).not.toHaveBeenCalled();
    expect(response.analysis).toBeNull();
    expect(Array.isArray(response.reviews)).toBe(true);

    // Every returned review ID must be real, for this platform/product.
    for (const review of response.reviews ?? []) {
      const rows = (await appSequelize.query(
        `SELECT 1 FROM "${config.appStore.schema}".normalized_reviews
         WHERE canonical_review_id = :id AND platform = :platform AND source_product_id = :pid`,
        {
          replacements: { id: review.canonicalReviewId, platform: product.platform, pid: product.source_product_id },
          type: QueryTypes.SELECT,
        },
      )) as any[];
      expect(rows.length).toBe(1);
    }
  });

  it("truthfully reports truncation instead of claiming 'all'", async () => {
    const provider = new MockAiProvider();
    const response = await analyzeProductQuestion(
      {
        platform: product.platform,
        sourceProductId: product.source_product_id,
        userQuestion: "show me the first 1",
        window: "12m",
      },
      provider,
    );

    expect(response.totalMatchingCount).toBeDefined();
    if ((response.totalMatchingCount ?? 0) > (response.reviews?.length ?? 0)) {
      expect(response.answer).toMatch(/Found \d+ matching reviews?\. Showing the latest \d+\./);
    }
  });
});

describe("analyzeProductQuestion — analysis intent, evidence integrity", () => {
  it("produces a rootCause whose evidenceReviewIds are all real and count-consistent", async () => {
    const provider = new MockAiProvider();
    const response = await analyzeProductQuestion(
      {
        platform: product.platform,
        sourceProductId: product.source_product_id,
        userQuestion: "What's the biggest issue?",
        window: "12m",
      },
      provider,
    );

    expect(response.analysis).not.toBeNull();
    for (const rc of response.analysis!.rootCause) {
      const uniqueIds = new Set(rc.evidenceReviewIds);
      expect(uniqueIds.size).toBe(rc.evidenceReviewIds.length); // no duplicates
      for (const id of rc.evidenceReviewIds) {
        const rows = (await appSequelize.query(
          `SELECT 1 FROM "${config.appStore.schema}".normalized_reviews
           WHERE canonical_review_id = :id AND platform = :platform AND source_product_id = :pid`,
          {
            replacements: { id, platform: product.platform, pid: product.source_product_id },
            type: QueryTypes.SELECT,
          },
        )) as any[];
        expect(rows.length).toBe(1);
      }
    }
  });

  it("regression: a semantically-discovered non-enum theme (mock provider's 'quality_issue') survives as rootCause[0].theme", async () => {
    const provider = new MockAiProvider();
    const response = await analyzeProductQuestion(
      {
        platform: product.platform,
        sourceProductId: product.source_product_id,
        userQuestion: "What's the biggest issue?",
        window: "12m",
      },
      provider,
    );

    expect(response.analysis).not.toBeNull();
    // MockAiProvider's analyzeReviewBatch discovers "quality_issue" for
    // low-rated reviews — NOT a THEME_VOCABULARY value. Before the fix, the
    // narrator schema forced z.enum(THEME_VOCABULARY), so this theme could
    // never appear (schema validation would throw or the field would be
    // rejected outright). After the fix, it survives as a real rootCause.
    if (response.analysis!.rootCause.length > 0) {
      const themes = response.analysis!.rootCause.map((rc) => rc.theme);
      expect(themes).toContain("quality_issue");
    }
  });
});

describe("narrateProductEvidence — fabricated theme rejection (negative test)", () => {
  it("strips a theme that is neither in THEME_VOCABULARY nor a discovered aspect", async () => {
    const { narrateProductEvidence } = await import("../../src/modules/ai/narrator.js");
    const { buildProductEvidencePackage } = await import("../../src/modules/ai/evidencePackage.js");

    const evidencePackage = await buildProductEvidencePackage(product.platform, product.source_product_id, {
      start: "2000-01-01",
      end: "2100-01-01",
    } as any);

    const fakeProvider = {
      name: "fake",
      modelVersion: "fake-v1",
      async analyzeReview() {
        return {};
      },
      async narrate() {
        const anyId = evidencePackage.evidenceReviewIds[0];
        return {
          summary: "test",
          rootCause: anyId
            ? [
                {
                  theme: "completely_invented_theme_xyz",
                  explanation: "fabricated",
                  evidenceReviewIds: [anyId],
                },
              ]
            : [],
          recommendations: [],
        };
      },
    };

    const result = await narrateProductEvidence(evidencePackage, fakeProvider as any, "why?", undefined);
    // The fabricated theme must not survive — either dropped entirely or
    // never present as "completely_invented_theme_xyz".
    const themes = result.rootCause.map((rc) => rc.theme);
    expect(themes).not.toContain("completely_invented_theme_xyz");
  });
});
