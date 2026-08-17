import { apiGet } from "../client";
import type { ProductReviewsResponse, Platform, NamedWindow } from "@/types/api";

export interface ReviewsParams {
  window?: NamedWindow;
  limit?: number;
  rating?: number;
  sentiment?: "positive" | "neutral" | "negative";
  theme?: string;
}

export function getProductReviews(
  platform: Platform,
  sourceProductId: string,
  params: ReviewsParams = {},
  signal?: AbortSignal,
) {
  const query: Record<string, string | number> = {};
  if (params.window) query.window = params.window;
  if (params.limit) query.limit = params.limit;
  if (params.rating) query.rating = params.rating;
  if (params.sentiment) query.sentiment = params.sentiment;
  if (params.theme) query.theme = params.theme;

  return apiGet<ProductReviewsResponse>(
    `/v1/products/${platform}/${encodeURIComponent(sourceProductId)}/reviews`,
    { query, signal },
  );
}
