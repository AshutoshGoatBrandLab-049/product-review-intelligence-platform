import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getBrandComparison } from "@/api/endpoints/brands";
import { getProductFamilyComparison } from "@/api/endpoints/marketplace";
import { queryKeys } from "@/api/queryKeys";
import type { NamedWindow } from "@/types/api";

export function useBrandComparison(brand: string, window: NamedWindow) {
  return useQuery({
    queryKey: queryKeys.brandComparison(brand, window),
    queryFn: ({ signal }) => getBrandComparison(brand, window, signal),
    enabled: brand.length > 0,
    // Phase 7 Step 7: same rationale as Product Detail's hooks — keep
    // showing the previous window's data while the new one loads, instead
    // of flashing back to a blank/skeleton page.
    placeholderData: keepPreviousData,
  });
}

export function useFamilyComparison(familyId: string, window: NamedWindow) {
  return useQuery({
    queryKey: queryKeys.familyComparison(familyId, window),
    queryFn: ({ signal }) => getProductFamilyComparison(familyId, window, signal),
    enabled: familyId.length > 0,
    // Phase 7 Step 8: same rationale as the brand/product-detail hooks —
    // keep showing the previous window's data while the new one loads,
    // instead of flashing back to a blank/skeleton page.
    placeholderData: keepPreviousData,
  });
}
