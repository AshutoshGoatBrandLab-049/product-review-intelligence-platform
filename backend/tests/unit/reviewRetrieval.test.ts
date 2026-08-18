import { describe, it, expect } from "vitest";
import { deriveReviewFiltersFromQuestion, retrieveReviews } from "../../src/modules/analytics/reviewRetrieval.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import { QueryTypes } from "sequelize";

describe("deriveReviewFiltersFromQuestion — English", () => {
  it("derives negative sentiment from 'show me all the bad reviews'", () => {
    expect(deriveReviewFiltersFromQuestion("show me all the bad reviews").sentiment).toBe("negative");
  });

  it("derives positive sentiment from 'give me the best reviews'", () => {
    expect(deriveReviewFiltersFromQuestion("give me the best reviews").sentiment).toBe("positive");
  });

  it("derives a limit from 'show me the first 3'", () => {
    expect(deriveReviewFiltersFromQuestion("show me the first 3").limit).toBe(3);
  });

  it("derives a limit from 'latest 20 reviews'", () => {
    expect(deriveReviewFiltersFromQuestion("latest 20 reviews").limit).toBe(20);
  });

  it("derives a rating from '1-star reviews'", () => {
    expect(deriveReviewFiltersFromQuestion("show me 1-star reviews").rating).toBe(1);
  });
});

describe("deriveReviewFiltersFromQuestion — Hinglish / Roman Hindi", () => {
  it("derives negative sentiment from 'kharaab reviews dikhao'", () => {
    expect(deriveReviewFiltersFromQuestion("kharaab reviews dikhao").sentiment).toBe("negative");
  });

  it("derives negative sentiment from 'kharab reviews dikhao'", () => {
    expect(deriveReviewFiltersFromQuestion("kharab reviews dikhao").sentiment).toBe("negative");
  });

  it("derives positive sentiment from 'achhe reviews dikhao'", () => {
    expect(deriveReviewFiltersFromQuestion("achhe reviews dikhao").sentiment).toBe("positive");
  });

  it("derives positive sentiment from 'badhiya reviews dikhao'", () => {
    expect(deriveReviewFiltersFromQuestion("badhiya reviews dikhao").sentiment).toBe("positive");
  });
});

describe("retrieveReviews — real local DB, truncation reporting", () => {
  it("returns totalMatchingCount independent of the applied limit cap", async () => {
    const products = (await appSequelize.query(
      `SELECT DISTINCT source_product_id, platform FROM "${config.appStore.schema}".normalized_reviews LIMIT 1`,
      { type: QueryTypes.SELECT },
    )) as any[];
    expect(products.length).toBeGreaterThan(0);
    const product = products[0];

    const unlimited = await retrieveReviews({
      platform: product.platform,
      sourceProductId: product.source_product_id,
      window: "12m",
    });

    const limited = await retrieveReviews({
      platform: product.platform,
      sourceProductId: product.source_product_id,
      window: "12m",
      limit: 1,
    });

    expect(limited.reviews.length).toBeLessThanOrEqual(1);
    expect(limited.totalMatchingCount).toBe(unlimited.totalMatchingCount);
    // Truncation is only real when there is more than 1 matching review.
    if (unlimited.totalMatchingCount > 1) {
      expect(limited.totalMatchingCount).toBeGreaterThan(limited.reviews.length);
    }
  });

  it("every returned review actually exists in normalized_reviews for the requested platform/product", async () => {
    const products = (await appSequelize.query(
      `SELECT DISTINCT source_product_id, platform FROM "${config.appStore.schema}".normalized_reviews LIMIT 1`,
      { type: QueryTypes.SELECT },
    )) as any[];
    const product = products[0];

    const result = await retrieveReviews({
      platform: product.platform,
      sourceProductId: product.source_product_id,
      window: "12m",
    });

    for (const review of result.reviews) {
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

  it("sentiment filter falls back to rating when review_sentiment is absent", async () => {
    const products = (await appSequelize.query(
      `SELECT DISTINCT source_product_id, platform FROM "${config.appStore.schema}".normalized_reviews LIMIT 1`,
      { type: QueryTypes.SELECT },
    )) as any[];
    const product = products[0];

    const negative = await retrieveReviews({
      platform: product.platform,
      sourceProductId: product.source_product_id,
      window: "12m",
      sentiment: "negative",
    });

    for (const review of negative.reviews) {
      // negative = sentiment label 'negative' OR rating <= 2 (rating-based fallback)
      expect(review.sentiment === "negative" || review.rating <= 2).toBe(true);
    }
  });
});
