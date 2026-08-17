import { describe, it, expect } from "vitest";
import { validateUnifiedReview } from "../../src/modules/ingestion/shared/validators.js";
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
    productUrl: null,
    reviewDate: "2026-08-01",
    reviewTimestamp: null,
    dateConfidence: "day",
    verifiedPurchase: true,
    hasImages: null,
    imageUrls: null,
    sizePurchased: null,
    colorPurchased: null,
    sourceUpdatedAt: new Date(),
    sourceExtra: null,
    ...overrides,
  };
}

describe("validateUnifiedReview", () => {
  it("passes a fully valid review", () => {
    expect(validateUnifiedReview(baseReview())).toEqual({ outcome: "pass" });
  });

  it("rejects a missing product id", () => {
    const result = validateUnifiedReview(baseReview({ sourceProductId: "" }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("missing_product_id");
  });

  it("rejects a missing review id", () => {
    const result = validateUnifiedReview(baseReview({ sourceReviewId: "" }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("missing_review_id");
  });

  it("rejects a missing rating", () => {
    const result = validateUnifiedReview(
      baseReview({ rating: null as unknown as number }),
    );
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("missing_rating");
  });

  it("rejects an out-of-range rating", () => {
    const result = validateUnifiedReview(baseReview({ rating: 7 }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("invalid_rating");
  });

  it("rejects a non-integer rating", () => {
    const result = validateUnifiedReview(baseReview({ rating: 3.5 }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("invalid_rating");
  });

  it("rejects an unparseable date", () => {
    const result = validateUnifiedReview(baseReview({ reviewDate: "not-a-date" }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("invalid_date");
  });

  it("rejects a date before the sanity floor (2007)", () => {
    const result = validateUnifiedReview(baseReview({ reviewDate: "2005-01-01" }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("invalid_date");
  });

  it("rejects a date far in the future", () => {
    const result = validateUnifiedReview(baseReview({ reviewDate: "2099-01-01" }));
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") expect(result.reason).toBe("invalid_date");
  });

  it("does NOT reject missing review text — rating-only reviews are legitimate", () => {
    const result = validateUnifiedReview(baseReview({ reviewText: null, title: null }));
    expect(result.outcome).not.toBe("reject");
  });

  it("flags, but does not reject, missing brand", () => {
    const result = validateUnifiedReview(baseReview({ brand: null }));
    expect(result.outcome).toBe("flag");
    if (result.outcome === "flag") expect(result.flags).toContain("brand_missing");
  });

  it("never includes review_text or author in a reject's failed_fields", () => {
    const result = validateUnifiedReview(
      baseReview({ sourceProductId: "", reviewText: "some free text", author: "Some Name" }),
    );
    expect(result.outcome).toBe("reject");
    if (result.outcome === "reject") {
      expect(result.failedFields).not.toHaveProperty("reviewText");
      expect(result.failedFields).not.toHaveProperty("author");
      const allowed = new Set(["sourceProductId", "sourceReviewId", "rating", "rawDateString", "platform"]);
      for (const key of Object.keys(result.failedFields)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });
});
