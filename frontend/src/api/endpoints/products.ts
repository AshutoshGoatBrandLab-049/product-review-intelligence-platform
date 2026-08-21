import type { DateRange } from "@/components/intelligence/DateRangeSelector";
import { apiGet } from "../client";
import type { Platform, ProductDetailResponse, ProductSignalsResponse, ProductInsightsResponse } from "@/types/api";

export function getProductDetail(platform: Platform, sourceProductId: string, range: DateRange, signal?: AbortSignal) {
  return apiGet<ProductDetailResponse>(`/v1/products/${platform}/${encodeURIComponent(sourceProductId)}`, { query: { from: range.from, to: range.to }, signal });
}

export function getProductSignals(platform: Platform, sourceProductId: string, range: DateRange, signal?: AbortSignal) {
  return apiGet<ProductSignalsResponse>(`/v1/products/${platform}/${encodeURIComponent(sourceProductId)}/signals`, { query: { from: range.from, to: range.to }, signal });
}

export function getProductInsights(platform: Platform, sourceProductId: string, range: DateRange, signal?: AbortSignal) {
  return apiGet<ProductInsightsResponse>(`/v1/products/${platform}/${encodeURIComponent(sourceProductId)}/insights`, { query: { from: range.from, to: range.to }, signal });
}
