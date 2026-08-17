import { apiGet } from "../client";
import type { NamedWindow, Platform, ProductDetailResponse, ProductSignalsResponse, ProductInsightsResponse } from "@/types/api";

export function getProductDetail(platform: Platform, sourceProductId: string, window: NamedWindow, signal?: AbortSignal) {
  return apiGet<ProductDetailResponse>(`/v1/products/${platform}/${encodeURIComponent(sourceProductId)}`, { query: { window }, signal });
}

export function getProductSignals(platform: Platform, sourceProductId: string, window: NamedWindow, signal?: AbortSignal) {
  return apiGet<ProductSignalsResponse>(`/v1/products/${platform}/${encodeURIComponent(sourceProductId)}/signals`, { query: { window }, signal });
}

export function getProductInsights(platform: Platform, sourceProductId: string, window: NamedWindow, signal?: AbortSignal) {
  return apiGet<ProductInsightsResponse>(`/v1/products/${platform}/${encodeURIComponent(sourceProductId)}/insights`, { query: { window }, signal });
}
