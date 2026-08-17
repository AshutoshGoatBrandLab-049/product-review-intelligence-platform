import { describe, it, expect, beforeEach } from "vitest";
import { QueryTypes } from "sequelize";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { rebuildAnalytics } from "../../src/modules/analytics/rebuild.js";
import { runAiSentimentPipeline } from "../../src/modules/ai/pipeline.js";
import { buildProductEvidencePackage } from "../../src/modules/ai/evidencePackage.js";
import { narrateProductEvidence } from "../../src/modules/ai/narrator.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import { resetAppStore } from "../helpers/resetAppStore.js";
import { THEME_VOCABULARY } from "../../src/database/appStore/models/reviewTheme.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import type { AiProvider } from "../../src/modules/ai/providers/aiProvider.js";

const WINDOW = resolveNamedWindow("30d");

/**
 * Directly grounds one evidence review with a known theme via a raw insert
 * into the isolated test fixture DB — deterministic and independent of
 * whatever incidental text the seed/mock pipeline happens to produce, rather
 * than hoping a specific theme keyword shows up in the fixture's review text.
 */
async function groundReviewInTheme(canonicalReviewId: string, theme: string): Promise<void> {
  const schema = config.appStore.schema;
  const [row] = await appSequelize.query<{ content_hash: string }>(
    `SELECT content_hash FROM "${schema}".normalized_reviews WHERE canonical_review_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: canonicalReviewId } },
  );
  await appSequelize.query(
    `INSERT INTO "${schema}".review_theme (canonical_review_id, theme, confidence, model_version, content_hash_at_extraction)
     VALUES (:id, :theme, 0.9, 'test-fixture-v1', :hash)
     ON CONFLICT (canonical_review_id, theme) DO NOTHING`,
    { replacements: { id: canonicalReviewId, theme, hash: row!.content_hash } },
  );
}

describe("evidence package & narrator (Phase 4 §4/§15/§16-18)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("item 28: evidence package correctness — every count is traceable, no fabricated fields", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);

    expect(pkg.reviewCount).toBeGreaterThan(0);
    expect(pkg.evidenceReviewIds.length).toBeLessThanOrEqual(20);
    // No sentiment/theme classification has run yet — must be null/empty, never fabricated.
    expect(pkg.sentimentDistribution).toBeNull();
    expect(pkg.topThemes).toEqual([]);
  });

  it("evidence package reflects real sentiment/theme data once classification has run", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);

    const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);
    expect(pkg.sentimentDistribution).not.toBeNull();
    const total = (pkg.sentimentDistribution!.positive + pkg.sentimentDistribution!.neutral + pkg.sentimentDistribution!.negative);
    expect(total).toBeGreaterThan(0);
  });

  it("item 15/30: narrator citations are validated against the evidence package — hallucinated IDs are rejected, real+relevant ones kept", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    let pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);
    expect(pkg.evidenceReviewIds.length).toBeGreaterThan(0); // fixture precondition — needs >=1 rating<=2 review

    const groundedId = pkg.evidenceReviewIds[0]!;
    const groundedTheme = "quality";
    await groundReviewInTheme(groundedId, groundedTheme);
    pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW); // rebuild to pick up the grounding just inserted

    const hallucinator: AiProvider = {
      name: "hallucinator",
      modelVersion: "test-v1",
      analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
      narrate: async () => ({
        summary: "test",
        rootCause: [{ theme: groundedTheme, explanation: "test", evidenceReviewIds: ["FAKE_ID_1", groundedId] }],
        recommendations: [{ reason: "test", evidenceReviewIds: ["FAKE_ID_2"], confidence: 0.5 }],
      }),
    };

    const result = await narrateProductEvidence(pkg, hallucinator);
    expect(result.rejectedCitations).toContain("FAKE_ID_1");
    expect(result.rejectedCitations).toContain("FAKE_ID_2");
    expect(result.rootCause[0]!.evidenceReviewIds).toContain(groundedId);
  });

  // Phase 4.1 remediation item 1 — citation *relevance*, not just citation
  // *validity*. Step 10 of Phase 4.1 found a real Gemini narrator attaching
  // themes to reviews with zero supporting theme evidence; these tests prove
  // the deterministic fix, never by asking another model to judge relevance.
  describe("citation relevance (Phase 4.1 remediation item 1)", () => {
    it("a real, valid review ID cited for a theme it does NOT have is stripped as irrelevant, not silently trusted", async () => {
      await runTrackA("flipkart");
      await rebuildAnalytics();
      const provider = new MockAiProvider();
      await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
      let pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);
      expect(pkg.evidenceReviewIds.length).toBeGreaterThan(0);

      const realId = pkg.evidenceReviewIds[0]!;
      const actualTheme = "quality";
      await groundReviewInTheme(realId, actualTheme);
      pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);

      const wrongTheme = THEME_VOCABULARY.find((t) => t !== actualTheme)!;

      const misattributor: AiProvider = {
        name: "misattributor",
        modelVersion: "test-v1",
        analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
        narrate: async () => ({
          summary: "test",
          rootCause: [{ theme: wrongTheme, explanation: "test", evidenceReviewIds: [realId] }],
          recommendations: [],
        }),
      };

      const result = await narrateProductEvidence(pkg, misattributor);
      expect(result.rejectedCitations).toEqual([]); // the ID IS real — this is not an existence failure
      expect(result.irrelevantCitations).toContain(realId);
      // Its only citation was stripped as irrelevant, so the whole unsupported claim is dropped, not left half-cited.
      expect(result.rootCause).toEqual([]);
      expect(result.droppedUnsupportedClaims).toBe(1);
    });

    it("sparse-evidence case (Step 10 shape: zero theme data) cannot produce an unsupported theme claim", async () => {
      // Deliberately built BEFORE any AI classification runs — reviewThemes
      // is empty by construction, exactly Step 10's real-world condition
      // (reviews exist, review_theme does not), reproduced in the isolated
      // fixture rather than requiring the restored local dataset.
      await runTrackA("flipkart");
      await rebuildAnalytics();
      const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);
      expect(pkg.topThemes).toEqual([]);
      expect(Object.keys(pkg.reviewThemes)).toEqual([]);

      if (pkg.evidenceReviewIds.length === 0) return; // nothing to attempt a false claim against in this fixture run

      const inventor: AiProvider = {
        name: "inventor",
        modelVersion: "test-v1",
        analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
        narrate: async () => ({
          summary: "test",
          rootCause: [{ theme: "quality", explanation: "invented — no theme evidence exists for this product at all", evidenceReviewIds: [pkg.evidenceReviewIds[0]!] }],
          recommendations: [{ reason: "invented", evidenceReviewIds: [pkg.evidenceReviewIds[0]!], confidence: 0.9, theme: "quality" }],
        }),
      };

      const result = await narrateProductEvidence(pkg, inventor);
      expect(result.rootCause).toEqual([]);
      expect(result.recommendations).toEqual([]);
      expect(result.droppedUnsupportedClaims).toBe(2);
      expect(result.irrelevantCitations).toContain(pkg.evidenceReviewIds[0]);
    });

    it("a recommendation with no theme set is exempt from relevance filtering (ID-existence only, as before)", async () => {
      await runTrackA("flipkart");
      await rebuildAnalytics();
      const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);
      if (pkg.evidenceReviewIds.length === 0) return;

      const generalAdvice: AiProvider = {
        name: "general-advice",
        modelVersion: "test-v1",
        analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
        narrate: async () => ({
          summary: "test",
          rootCause: [],
          recommendations: [{ reason: "General follow-up recommended, not tied to one theme.", evidenceReviewIds: [pkg.evidenceReviewIds[0]!], confidence: 0.6 }],
        }),
      };

      const result = await narrateProductEvidence(pkg, generalAdvice);
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0]!.evidenceReviewIds).toContain(pkg.evidenceReviewIds[0]);
      expect(result.droppedUnsupportedClaims).toBe(0);
    });
  });

  it("item 29: narrator cannot invent metrics — malformed/out-of-schema narrator output is rejected outright", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);

    const badProvider: AiProvider = {
      name: "bad",
      modelVersion: "test-v1",
      analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
      narrate: async () => ({ summary: "the product has a 4.9 average rating and 99% positive reviews" /* missing required fields */ }),
    };

    await expect(narrateProductEvidence(pkg, badProvider)).rejects.toThrow(/schema validation/);
  });

  it("the mock narrator never needs a rejected citation — it only ever cites IDs already in the package", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.rejectedCitations).toEqual([]);
  });

  // Original Phase 4.1 Step 10 ("Numerical Claim Safety") — the specific test
  // that step's recovered specification named: evidence states one
  // percentage, model output states a different, wrong one. Zero real Gemini
  // calls needed — this tests whether narrateProductEvidence()'s OWN
  // validation logic would catch a deliberately mismatched number, not
  // whether a real model happens to produce one. Documented, not silently
  // fixed here — this is a known, disclosed limitation (Phase 4.1
  // remediation item 1 fixed citation *relevance*, not numeric-claim
  // grounding, which is a distinct concern).
  it("ORIGINAL STEP 10: evidence states one percentage, narrator output states a different one — NOT CAUGHT (documented limitation, not fixed)", async () => {
    await runTrackA("flipkart");
    await rebuildAnalytics();
    const provider = new MockAiProvider();
    await runAiSentimentPipeline({ platform: "flipkart", dryRun: false }, provider);
    const pkg = await buildProductEvidencePackage("flipkart", "PID001", WINDOW);
    expect(pkg.positivePercentage).not.toBeNull();

    const realPercentage = pkg.positivePercentage!;
    const wrongPercentage = (realPercentage + 3).toFixed(2); // deliberately wrong, mirrors the spec's 42-vs-45 shape

    const misstater: AiProvider = {
      name: "misstater",
      modelVersion: "test-v1",
      analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
      narrate: async () => ({
        // States a percentage that does NOT match pkg.positivePercentage — the exact scenario the original spec asked to test.
        summary: `Among the analyzed reviews, customer sentiment is predominantly positive at ${wrongPercentage}%.`,
        rootCause: [],
        recommendations: [],
      }),
    };

    const result = await narrateProductEvidence(pkg, misstater);
    // Current validation (schema + citation-ID + citation-relevance) has NO mechanism that
    // inspects numeric content embedded in free-text `summary` — so a wrong number passes
    // through completely unflagged. This assertion documents that gap by proving it: the
    // mismatched summary is accepted as-is, byte for byte, with nothing catching it.
    expect(result.summary).toBe(`Among the analyzed reviews, customer sentiment is predominantly positive at ${wrongPercentage}%.`);
    expect(result.summary).not.toContain(String(realPercentage));
  });
});
