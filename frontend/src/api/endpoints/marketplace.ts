import { apiGet } from "../client";
import type { NamedWindow, ProductMarketplaceComparison } from "@/types/api";

export function getProductFamilyComparison(familyId: string, window: NamedWindow, signal?: AbortSignal) {
  return apiGet<ProductMarketplaceComparison>(`/v1/products/family/${encodeURIComponent(familyId)}/compare`, { query: { window }, signal });
}
