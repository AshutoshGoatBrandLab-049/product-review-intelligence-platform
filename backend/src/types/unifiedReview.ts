export type Platform = "flipkart" | "myntra";
export type IdentityConfidence = "native" | "derived";
export type DateConfidence = "exact" | "day" | "month";

/**
 * The canonical, cross-platform review shape both mappers produce and both
 * ingestion tracks consume. Fields not applicable to a platform are `null`,
 * never omitted — see the common/marketplace-specific split, Phase 2 §3.
 */
export interface UnifiedReview {
  platform: Platform;
  sourceProductId: string;
  sourceReviewId: string;
  sourceRowId: number;
  identityConfidence: IdentityConfidence;

  brand: string | null;
  rating: number;
  title: string | null;
  reviewText: string | null;
  author: string | null;
  helpfulCount: number | null;
  notHelpfulCount: number | null;
  country: string | null;
  productUrl: string | null;

  reviewDate: string; // YYYY-MM-DD
  reviewTimestamp: Date | null;
  dateConfidence: DateConfidence;

  // Flipkart-only
  verifiedPurchase: boolean | null;

  // Myntra-only
  hasImages: boolean | null;
  imageUrls: string[] | null;
  sizePurchased: string | null;
  colorPurchased: string | null;

  sourceUpdatedAt: Date;
  sourceExtra: Record<string, unknown> | null;
}

/** Raw row shape as read directly from DataWarehouse.flipkart_reviews. */
export interface RawFlipkartReview {
  id: number;
  pid: string;
  review_id: string;
  brand_name: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  review_date: string;
  product_url: string | null;
  author_name: string | null;
  verified_purchase: boolean | null;
  helpful_count: number | null;
  country: string | null;
  updatedAt: Date;
}

/** Raw row shape as read directly from DataWarehouse.myntra_reviews. */
export interface RawMyntraReview {
  id: number;
  product_id: number;
  review_id: string;
  brand_name: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  review_date: string;
  reviewed_at: Date | null;
  author_name: string | null;
  helpful_count: number | null;
  not_helpful_count: number | null;
  has_images: boolean | null;
  image_urls: string[] | null;
  size_purchased: string | null;
  color_purchased: string | null;
  product_url: string | null;
  country: string | null;
  updatedAt: Date;
}
