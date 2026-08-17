import type { RawMyntraReview, UnifiedReview } from "../../../types/unifiedReview.js";

export const MYNTRA_MAPPER_VERSION = 1;

export function mapMyntraReview(raw: RawMyntraReview): UnifiedReview {
  const reviewDate =
    typeof raw.review_date === "string" ? raw.review_date.slice(0, 10) : String(raw.review_date);

  return {
    platform: "myntra",
    sourceProductId: String(raw.product_id),
    sourceReviewId: raw.review_id,
    sourceRowId: raw.id,
    identityConfidence: "native", // Myntra review_id is the marketplace's own permanent ID

    brand: raw.brand_name,
    rating: raw.rating,
    title: raw.title, // always null upstream — Myntra's API has no title field
    reviewText: raw.body,
    author: raw.author_name,
    helpfulCount: raw.helpful_count,
    notHelpfulCount: raw.not_helpful_count,
    country: raw.country,
    productUrl: raw.product_url,

    reviewDate,
    reviewTimestamp: raw.reviewed_at,
    dateConfidence: "exact", // Myntra always has a true timestamp

    verifiedPurchase: null, // not a Myntra field

    hasImages: raw.has_images,
    imageUrls: raw.image_urls,
    sizePurchased: raw.size_purchased,
    colorPurchased: raw.color_purchased,

    sourceUpdatedAt: raw.updatedAt,
    sourceExtra: null,
  };
}
