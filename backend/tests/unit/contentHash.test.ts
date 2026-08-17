import { describe, it, expect } from "vitest";
import { computeContentHash } from "../../src/modules/ingestion/shared/contentHash.js";
import type { UnifiedReview } from "../../src/types/unifiedReview.js";

function baseReview(overrides: Partial<UnifiedReview> = {}): UnifiedReview {
  return {
    platform: "flipkart",
    sourceProductId: "PID001",
    sourceReviewId: "R1",
    sourceRowId: 1,
    identityConfidence: "derived",
    brand: "BrandA",
    rating: 5,
    title: "Great",
    reviewText: "Loved it",
    author: "Ravi K",
    helpfulCount: 0,
    notHelpfulCount: null,
    country: "India",
    productUrl: "https://flipkart.com/x/p/x?pid=PID001",
    reviewDate: "2026-08-01",
    reviewTimestamp: null,
    dateConfidence: "day",
    verifiedPurchase: true,
    hasImages: null,
    imageUrls: null,
    sizePurchased: null,
    colorPurchased: null,
    sourceUpdatedAt: new Date("2026-08-01T00:00:00Z"),
    sourceExtra: null,
    ...overrides,
  };
}

describe("computeContentHash", () => {
  it("is deterministic for identical input", () => {
    const review = baseReview();
    expect(computeContentHash(review)).toBe(computeContentHash(baseReview()));
  });

  it("is stable when only source_updated_at changes (the entire point of the redesign)", () => {
    const h1 = computeContentHash(baseReview({ sourceUpdatedAt: new Date("2026-08-01T00:00:00Z") }));
    const h2 = computeContentHash(baseReview({ sourceUpdatedAt: new Date("2026-08-11T00:00:00Z") }));
    expect(h1).toBe(h2);
  });

  it("is stable when country changes (excluded, effectively constant)", () => {
    const h1 = computeContentHash(baseReview({ country: "India" }));
    const h2 = computeContentHash(baseReview({ country: "Other" }));
    expect(h1).toBe(h2);
  });

  it("is stable when product_url changes (excluded, derived/denormalized)", () => {
    const h1 = computeContentHash(baseReview({ productUrl: "https://a" }));
    const h2 = computeContentHash(baseReview({ productUrl: "https://b" }));
    expect(h1).toBe(h2);
  });

  it("changes when rating changes", () => {
    const h1 = computeContentHash(baseReview({ rating: 5 }));
    const h2 = computeContentHash(baseReview({ rating: 1 }));
    expect(h1).not.toBe(h2);
  });

  it("changes when review text changes", () => {
    const h1 = computeContentHash(baseReview({ reviewText: "Great" }));
    const h2 = computeContentHash(baseReview({ reviewText: "Terrible" }));
    expect(h1).not.toBe(h2);
  });

  it("changes when author changes — diagnostic for identity-collision detection", () => {
    const h1 = computeContentHash(baseReview({ author: "Ravi K" }));
    const h2 = computeContentHash(baseReview({ author: "Someone Else" }));
    expect(h1).not.toBe(h2);
  });

  it("treats null and empty-string review text as equivalent", () => {
    const h1 = computeContentHash(baseReview({ reviewText: null }));
    const h2 = computeContentHash(baseReview({ reviewText: "" }));
    expect(h1).toBe(h2);
  });

  it("treats null and empty-string review text as equivalent even with surrounding whitespace", () => {
    const h1 = computeContentHash(baseReview({ reviewText: null }));
    const h2 = computeContentHash(baseReview({ reviewText: "   " }));
    expect(h1).toBe(h2);
  });

  it("is insensitive to image_urls array order (sorted before hashing)", () => {
    const h1 = computeContentHash(
      baseReview({ platform: "myntra", imageUrls: ["https://a", "https://b"] }),
    );
    const h2 = computeContentHash(
      baseReview({ platform: "myntra", imageUrls: ["https://b", "https://a"] }),
    );
    expect(h1).toBe(h2);
  });

  it("changes when the actual set of image_urls changes", () => {
    const h1 = computeContentHash(baseReview({ platform: "myntra", imageUrls: ["https://a"] }));
    const h2 = computeContentHash(baseReview({ platform: "myntra", imageUrls: ["https://c"] }));
    expect(h1).not.toBe(h2);
  });
});
