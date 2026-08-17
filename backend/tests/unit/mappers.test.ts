import { describe, it, expect } from "vitest";
import { mapFlipkartReview } from "../../src/modules/ingestion/flipkart/mapper.js";
import { mapMyntraReview } from "../../src/modules/ingestion/myntra/mapper.js";
import type { RawFlipkartReview, RawMyntraReview } from "../../src/types/unifiedReview.js";

describe("mapFlipkartReview", () => {
  const raw: RawFlipkartReview = {
    id: 42,
    pid: "PID001",
    review_id: "fk_hash_0001",
    brand_name: "BrandA",
    rating: 5,
    title: "Great",
    comment: "Loved it",
    review_date: "2026-08-05",
    product_url: "https://flipkart.com/x/p/x?pid=PID001",
    author_name: "Ravi K",
    verified_purchase: true,
    helpful_count: 0,
    country: "India",
    updatedAt: new Date("2026-08-06T00:00:00Z"),
  };

  it("maps identity fields correctly, marking identity as derived", () => {
    const unified = mapFlipkartReview(raw);
    expect(unified.platform).toBe("flipkart");
    expect(unified.sourceProductId).toBe("PID001");
    expect(unified.sourceReviewId).toBe("fk_hash_0001");
    expect(unified.identityConfidence).toBe("derived");
  });

  it("never fabricates a timestamp — Flipkart has none", () => {
    const unified = mapFlipkartReview(raw);
    expect(unified.reviewTimestamp).toBeNull();
  });

  it("leaves Myntra-only fields null", () => {
    const unified = mapFlipkartReview(raw);
    expect(unified.hasImages).toBeNull();
    expect(unified.imageUrls).toBeNull();
    expect(unified.sizePurchased).toBeNull();
    expect(unified.colorPurchased).toBeNull();
    expect(unified.notHelpfulCount).toBeNull();
  });

  it("approximates date_confidence as 'day' for a recent review", () => {
    const recentRaw = { ...raw, review_date: "2026-08-10" };
    const unified = mapFlipkartReview(recentRaw, new Date("2026-08-11T00:00:00Z"));
    expect(unified.dateConfidence).toBe("day");
  });

  it("approximates date_confidence as 'month' for an old review", () => {
    const oldRaw = { ...raw, review_date: "2026-01-01" };
    const unified = mapFlipkartReview(oldRaw, new Date("2026-08-11T00:00:00Z"));
    expect(unified.dateConfidence).toBe("month");
  });
});

describe("mapMyntraReview", () => {
  const raw: RawMyntraReview = {
    id: 99,
    product_id: 5001,
    review_id: "myn_r_0001",
    brand_name: "BrandC",
    rating: 5,
    title: null,
    body: "Perfect fit",
    review_date: "2026-08-10",
    reviewed_at: new Date("2026-08-10T12:00:00Z"),
    author_name: "Priya M",
    helpful_count: 3,
    not_helpful_count: 0,
    has_images: true,
    image_urls: ["https://img/a.jpg"],
    size_purchased: "M",
    color_purchased: "Blue",
    product_url: "https://myntra.com/reviews/5001",
    country: "India",
    updatedAt: new Date("2026-08-10T12:00:00Z"),
  };

  it("maps identity fields correctly, marking identity as native", () => {
    const unified = mapMyntraReview(raw);
    expect(unified.platform).toBe("myntra");
    expect(unified.sourceProductId).toBe("5001"); // numeric product_id cast to string
    expect(unified.sourceReviewId).toBe("myn_r_0001");
    expect(unified.identityConfidence).toBe("native");
  });

  it("always has a null title — Myntra's API has no title field", () => {
    const unified = mapMyntraReview(raw);
    expect(unified.title).toBeNull();
  });

  it("is always exact date_confidence — Myntra has a true timestamp", () => {
    const unified = mapMyntraReview(raw);
    expect(unified.dateConfidence).toBe("exact");
    expect(unified.reviewTimestamp).toEqual(raw.reviewed_at);
  });

  it("leaves Flipkart-only fields null", () => {
    const unified = mapMyntraReview(raw);
    expect(unified.verifiedPurchase).toBeNull();
  });

  it("carries through Myntra-only fields", () => {
    const unified = mapMyntraReview(raw);
    expect(unified.hasImages).toBe(true);
    expect(unified.imageUrls).toEqual(["https://img/a.jpg"]);
    expect(unified.sizePurchased).toBe("M");
    expect(unified.colorPurchased).toBe("Blue");
    expect(unified.notHelpfulCount).toBe(0);
  });
});
