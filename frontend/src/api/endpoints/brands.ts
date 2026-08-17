import { apiGet } from "../client";
import type { BrandMarketplaceComparison, NamedWindow } from "@/types/api";

export function getBrandComparison(brand: string, window: NamedWindow, signal?: AbortSignal) {
  return apiGet<BrandMarketplaceComparison>(`/v1/brands/${encodeURIComponent(brand)}/compare`, { query: { window }, signal });
}
