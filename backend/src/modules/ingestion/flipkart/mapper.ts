import type { DateConfidence, RawFlipkartReview, UnifiedReview } from "../../../types/unifiedReview.js";

export const FLIPKART_MAPPER_VERSION = 1;

/**
 * Approximates Flipkart's date_confidence from the stored review_date alone.
 *
 * Neither flipkart_reviews nor this platform has access to the original
 * relative-date text ("3 days ago" vs "2 months ago") that produced
 * review_date upstream — only the crawler's own process saw that text, and
 * it isn't persisted. This is therefore a documented approximation, not a
 * precise reconstruction: reviews within ~35 days of ingestion are assumed
 * to have originated from a day/week-precision relative string; older ones
 * from a month/year-precision one (Flipkart anchors those to the 1st of the
 * month upstream). Marked explicitly so it's never mistaken for certainty.
 */
function approximateFlipkartDateConfidence(reviewDate: string, ingestedAt: Date): DateConfidence {
  const reviewDateMs = new Date(`${reviewDate}T00:00:00Z`).getTime();
  const daysSince = (ingestedAt.getTime() - reviewDateMs) / (1000 * 60 * 60 * 24);
  return daysSince <= 35 ? "day" : "month";
}

export function mapFlipkartReview(raw: RawFlipkartReview, ingestedAt: Date = new Date()): UnifiedReview {
  const reviewDate =
    typeof raw.review_date === "string" ? raw.review_date.slice(0, 10) : String(raw.review_date);

  return {
    platform: "flipkart",
    sourceProductId: raw.pid,
    sourceReviewId: raw.review_id,
    sourceRowId: raw.id,
    identityConfidence: "derived", // Flipkart review_id is a synthetic hash, not marketplace-native

    brand: raw.brand_name,
    rating: raw.rating,
    title: raw.title,
    reviewText: raw.comment,
    author: raw.author_name,
    helpfulCount: raw.helpful_count,
    notHelpfulCount: null, // not a Flipkart field
    country: raw.country,
    productUrl: raw.product_url,

    reviewDate,
    reviewTimestamp: null, // Flipkart has no true timestamp, ever
    dateConfidence: approximateFlipkartDateConfidence(reviewDate, ingestedAt),

    verifiedPurchase: raw.verified_purchase,

    hasImages: null,
    imageUrls: null,
    sizePurchased: null,
    colorPurchased: null,

    sourceUpdatedAt: raw.updatedAt,
    sourceExtra: null,
  };
}
