import { apiGet } from "../client";
import type { ProductReviewsResponse, Platform, NamedWindow } from "@/types/api";

export interface ReviewsParams {
  window?: NamedWindow;
  limit?: number;
  rating?: number;
  sentiment?: "positive" | "neutral" | "negative";
  theme?: string;
}

export interface ProductRanking {
  sourceProductId: string;
  platform: Platform;
  rank: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  totalInLatestTen: number;
  averageRating: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReviewsOverviewResponse {
  products: ProductRanking[];
  pagination: PaginationMeta;
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

export interface ReviewsOverviewParams {
  platform: "flipkart" | "myntra";
  type: "negative" | "positive";
  page?: number;
  reviewWindow?: "latest10" | "latest20" | "latest50" | "latest100" | "custom";
  customFromDate?: string;
  customToDate?: string;
  sortBy?: "ratingAsc" | "ratingDesc" | "default";
}

export function getReviewsOverview(params: ReviewsOverviewParams, signal?: AbortSignal) {
  const query: Record<string, string | number> = {
    platform: params.platform,
    type: params.type,
  };
  if (params.page !== undefined) query.page = params.page;
  if (params.reviewWindow) query.reviewWindow = params.reviewWindow;
  if (params.customFromDate) query.customFromDate = params.customFromDate;
  if (params.customToDate) query.customToDate = params.customToDate;
  if (params.sortBy) query.sortBy = params.sortBy;

  return apiGet<ReviewsOverviewResponse>("/v1/reviews/overview", { query, signal });
}
