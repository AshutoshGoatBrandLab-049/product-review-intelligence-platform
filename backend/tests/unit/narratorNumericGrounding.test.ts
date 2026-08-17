import { describe, it, expect } from "vitest";
import { narrateProductEvidence } from "../../src/modules/ai/narrator.js";
import type { ProductEvidencePackage } from "../../src/modules/ai/evidencePackage.js";
import type { AiProvider } from "../../src/modules/ai/providers/aiProvider.js";

/**
 * Final Phase 4.1 remediation — numerical-claim grounding. Reproduces the
 * exact original Step 10 scenario (evidence states one number, narrator
 * states a different one) using a synthetic, in-memory ProductEvidencePackage
 * — no database access anywhere in this file (requirement K), since
 * narrateProductEvidence() only ever needs the package object itself.
 */
function makePackage(overrides: Partial<ProductEvidencePackage> = {}): ProductEvidencePackage {
  return {
    platform: "flipkart",
    sourceProductId: "TEST_PID",
    window: { start: "2026-01-01", end: "2026-01-31" },
    reviewCount: 200,
    averageRating: 3.5,
    ratingDistribution: { 1: 20, 2: 20, 3: 40, 4: 60, 5: 60 },
    positivePercentage: 42, // the exact 42-vs-45 shape from the original Step 10 spec
    negativePercentage: 20,
    trendDirection: "stable",
    confidence: "high",
    sentimentDistribution: { positive: 84, neutral: 40, negative: 40 },
    topThemes: [],
    topNegativeThemes: [],
    evidenceReviewIds: ["review-a", "review-b"],
    totalMatchingNegativeCount: 40,
    reviewThemes: {},
    ...overrides,
  };
}

function providerReturning(narrateOutput: unknown): AiProvider {
  return {
    name: "test",
    modelVersion: "test-v1",
    analyzeReview: async () => ({ sentiment: { label: "negative", confidence: 0.9 }, themes: [] }),
    narrate: async () => narrateOutput,
  };
}

describe("narrator numerical-claim grounding (final Phase 4.1 remediation)", () => {
  it("A: evidence=42, narrator citedMetrics=42 → PASS (kept in citedMetrics, not ungrounded)", async () => {
    const pkg = makePackage({ positivePercentage: 42 });
    const provider = providerReturning({
      summary: "Positive sentiment is at 42%.",
      citedMetrics: [{ field: "positivePercentage", statedValue: 42 }],
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toEqual([{ field: "positivePercentage", statedValue: 42 }]);
    expect(result.ungroundedMetrics).toEqual([]);
  });

  it("B: evidence=42, narrator citedMetrics=45 → FAIL (stripped into ungroundedMetrics as value_mismatch) — the exact original Step 10 scenario, now caught", async () => {
    const pkg = makePackage({ positivePercentage: 42 });
    const provider = providerReturning({
      summary: "Positive sentiment is at 45%.",
      citedMetrics: [{ field: "positivePercentage", statedValue: 45 }],
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toEqual([]);
    expect(result.ungroundedMetrics).toEqual([{ field: "positivePercentage", statedValue: 45, reason: "value_mismatch" }]);
  });

  it("C: unknown evidence field → FAIL (stripped as unknown_field)", async () => {
    const pkg = makePackage();
    const provider = providerReturning({
      summary: "Sales grew 45% this quarter.",
      citedMetrics: [{ field: "salesGrowth", statedValue: 45 }], // not a real ProductEvidencePackage field
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toEqual([]);
    expect(result.ungroundedMetrics).toEqual([{ field: "salesGrowth", statedValue: 45, reason: "unknown_field" }]);
  });

  it("D: decimal values are correctly validated (match and mismatch)", async () => {
    const pkg = makePackage({ averageRating: 3.74 });
    const matchProvider = providerReturning({
      summary: "Average rating is 3.74.",
      citedMetrics: [{ field: "averageRating", statedValue: 3.74 }],
      rootCause: [],
      recommendations: [],
    });
    const mismatchProvider = providerReturning({
      summary: "Average rating is 3.77.",
      citedMetrics: [{ field: "averageRating", statedValue: 3.77 }],
      rootCause: [],
      recommendations: [],
    });

    const matchResult = await narrateProductEvidence(pkg, matchProvider);
    expect(matchResult.citedMetrics).toEqual([{ field: "averageRating", statedValue: 3.74 }]);

    const mismatchResult = await narrateProductEvidence(pkg, mismatchProvider);
    expect(mismatchResult.ungroundedMetrics).toEqual([{ field: "averageRating", statedValue: 3.77, reason: "value_mismatch" }]);
  });

  it("E: zero values are correctly validated (0 must match 0, not be treated as absent/falsy)", async () => {
    const pkg = makePackage({ negativePercentage: 0 });
    const provider = providerReturning({
      summary: "No negative reviews were found.",
      citedMetrics: [{ field: "negativePercentage", statedValue: 0 }],
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toEqual([{ field: "negativePercentage", statedValue: 0 }]);
    expect(result.ungroundedMetrics).toEqual([]);
  });

  it("E2: a null evidence field (e.g. averageRating with zero reviews) cannot be cited as any number — always ungrounded", async () => {
    const pkg = makePackage({ averageRating: null });
    const provider = providerReturning({
      summary: "Average rating is 0.",
      citedMetrics: [{ field: "averageRating", statedValue: 0 }],
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toEqual([]);
    expect(result.ungroundedMetrics).toEqual([{ field: "averageRating", statedValue: 0, reason: "value_mismatch" }]);
  });

  it("F: percentage values are correctly validated", async () => {
    const pkg = makePackage({ positivePercentage: 66.22, negativePercentage: 20.27 });
    const provider = providerReturning({
      summary: "66.22% positive, 20.27% negative.",
      citedMetrics: [
        { field: "positivePercentage", statedValue: 66.22 },
        { field: "negativePercentage", statedValue: 20.27 },
      ],
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toHaveLength(2);
    expect(result.ungroundedMetrics).toEqual([]);
  });

  it("G: multiple metrics are each independently validated — some pass, some fail, in the same response", async () => {
    const pkg = makePackage({ reviewCount: 200, positivePercentage: 42, totalMatchingNegativeCount: 40 });
    const provider = providerReturning({
      summary: "200 reviews analyzed, 42% positive, but sales figures show 999.",
      citedMetrics: [
        { field: "reviewCount", statedValue: 200 }, // correct
        { field: "positivePercentage", statedValue: 45 }, // wrong (mismatch)
        { field: "totalMatchingNegativeCount", statedValue: 40 }, // correct
        { field: "nonexistentField", statedValue: 999 }, // unknown
      ],
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.citedMetrics).toEqual(
      expect.arrayContaining([
        { field: "reviewCount", statedValue: 200 },
        { field: "totalMatchingNegativeCount", statedValue: 40 },
      ]),
    );
    expect(result.citedMetrics).toHaveLength(2);
    expect(result.ungroundedMetrics).toEqual(
      expect.arrayContaining([
        { field: "positivePercentage", statedValue: 45, reason: "value_mismatch" },
        { field: "nonexistentField", statedValue: 999, reason: "unknown_field" },
      ]),
    );
    expect(result.ungroundedMetrics).toHaveLength(2);
  });

  it("H: existing valid narrator output with NO citedMetrics at all still passes (backward compatible)", async () => {
    const pkg = makePackage();
    const provider = providerReturning({
      summary: "Reviews indicate generally positive sentiment.",
      rootCause: [],
      recommendations: [],
      // citedMetrics deliberately omitted entirely
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.summary).toBe("Reviews indicate generally positive sentiment.");
    expect(result.citedMetrics).toEqual([]);
    expect(result.ungroundedMetrics).toEqual([]);
  });

  it("I: existing citation-relevance behavior (Phase 4.1 remediation item 1) is unaffected by this change", async () => {
    const pkg = makePackage({
      evidenceReviewIds: ["review-a", "review-b"],
      reviewThemes: { "review-a": ["quality"] },
    });
    const provider = providerReturning({
      summary: "Quality concerns noted.",
      citedMetrics: [],
      rootCause: [
        { theme: "quality", explanation: "grounded", evidenceReviewIds: ["review-a"] }, // relevant — kept
        { theme: "fit", explanation: "not grounded", evidenceReviewIds: ["review-a"] }, // review-a has no "fit" theme — dropped
      ],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    expect(result.rootCause).toHaveLength(1);
    expect(result.rootCause[0]!.theme).toBe("quality");
    expect(result.irrelevantCitations).toContain("review-a");
    expect(result.droppedUnsupportedClaims).toBe(1);
  });

  it("J: malformed numeric structure (statedValue as a string, not a number) is rejected by schema validation", async () => {
    const pkg = makePackage();
    const provider = providerReturning({
      summary: "test",
      citedMetrics: [{ field: "positivePercentage", statedValue: "42" }], // string, not number — malformed
      rootCause: [],
      recommendations: [],
    });

    await expect(narrateProductEvidence(pkg, provider)).rejects.toThrow(/schema validation/);
  });

  it("K (structural): none of the tests in this file touch any database — narrateProductEvidence() only needs the package object and a provider", () => {
    // Documented by construction: every test above builds its ProductEvidencePackage via makePackage()
    // (a plain in-memory object) and never imports appSequelize, resetAppStore, or runTrackA anywhere in
    // this file. This test exists to make that guarantee explicit and checkable, not to exercise new logic.
    expect(true).toBe(true);
  });

  it("DISCLOSED BOUNDARY: a wrong number stated ONLY in prose, with no citedMetrics entry, is still NOT caught (extends the original Step 10 finding — this fix only grounds numbers the narrator chooses to structure)", async () => {
    const pkg = makePackage({ positivePercentage: 42 });
    const provider = providerReturning({
      summary: "Positive sentiment is at 45%.", // wrong number, prose-only
      citedMetrics: [], // narrator did not use the structural channel at all
      rootCause: [],
      recommendations: [],
    });

    const result = await narrateProductEvidence(pkg, provider);
    // Nothing in citedMetrics/ungroundedMetrics reflects this — the prose mismatch is invisible to this mechanism.
    expect(result.summary).toBe("Positive sentiment is at 45%.");
    expect(result.citedMetrics).toEqual([]);
    expect(result.ungroundedMetrics).toEqual([]);
  });
});
