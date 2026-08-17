import { describe, it, expect } from "vitest";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import { validateAiOutput } from "../../src/modules/ai/validation.js";

describe("MockAiProvider (Phase 4 §11)", () => {
  it("item 1: is deterministic — the same input always produces the same output", async () => {
    const provider = new MockAiProvider();
    const input = { canonicalReviewId: "x", rating: 5, title: "Great quality", reviewText: "Fast delivery too" };
    const a = await provider.analyzeReview(input);
    const b = await provider.analyzeReview(input);
    expect(a).toEqual(b);
  });

  it("produces schema-valid output for every rating 1-5", async () => {
    const provider = new MockAiProvider();
    for (const rating of [1, 2, 3, 4, 5]) {
      const output = await provider.analyzeReview({ canonicalReviewId: "x", rating, title: "t", reviewText: "quality delivery" });
      expect(validateAiOutput(output).valid).toBe(true);
    }
  });

  it("maps rating to sentiment deterministically: >=4 positive, ==3 neutral, <=2 negative", async () => {
    const provider = new MockAiProvider();
    const positive = (await provider.analyzeReview({ canonicalReviewId: "x", rating: 5, title: null, reviewText: null })) as { sentiment: { label: string } };
    const neutral = (await provider.analyzeReview({ canonicalReviewId: "x", rating: 3, title: null, reviewText: null })) as { sentiment: { label: string } };
    const negative = (await provider.analyzeReview({ canonicalReviewId: "x", rating: 1, title: null, reviewText: null })) as { sentiment: { label: string } };
    expect(positive.sentiment.label).toBe("positive");
    expect(neutral.sentiment.label).toBe("neutral");
    expect(negative.sentiment.label).toBe("negative");
  });

  it("item 17: injectFailures makes the next N calls throw, then resumes normally", async () => {
    const provider = new MockAiProvider();
    provider.injectFailures(2);
    await expect(provider.analyzeReview({ canonicalReviewId: "x", rating: 5, title: null, reviewText: null })).rejects.toThrow();
    await expect(provider.analyzeReview({ canonicalReviewId: "x", rating: 5, title: null, reviewText: null })).rejects.toThrow();
    await expect(provider.analyzeReview({ canonicalReviewId: "x", rating: 5, title: null, reviewText: null })).resolves.toBeDefined();
  });

  it("makes no network call and requires no credentials — pure in-process function", async () => {
    const provider = new MockAiProvider();
    // If this ever tried to reach a network, it would time out or throw a DNS/connection error.
    await expect(provider.analyzeReview({ canonicalReviewId: "x", rating: 4, title: null, reviewText: null })).resolves.toBeDefined();
  });
});
