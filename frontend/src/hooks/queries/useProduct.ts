import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getProductDetail, getProductSignals, getProductInsights } from "@/api/endpoints/products";
import { queryKeys } from "@/api/queryKeys";
import type { NamedWindow, Platform } from "@/types/api";

export function useProductDetail(platform: Platform, sourceProductId: string, window: NamedWindow) {
  return useQuery({
    queryKey: queryKeys.productDetail(platform, sourceProductId, window),
    queryFn: ({ signal }) => getProductDetail(platform, sourceProductId, window, signal),
    // Phase 7 Step 3 (§ Window behavior): keep showing the previous
    // window's data while the new one loads, instead of flashing back to
    // a blank/skeleton page.
    placeholderData: keepPreviousData,
  });
}

export function useProductSignals(platform: Platform, sourceProductId: string, window: NamedWindow) {
  return useQuery({
    queryKey: queryKeys.productSignals(platform, sourceProductId, window),
    queryFn: ({ signal }) => getProductSignals(platform, sourceProductId, window, signal),
    placeholderData: keepPreviousData,
  });
}

/**
 * Insights can be slow on a real cache miss (real AI provider latency —
 * NOT MEASURED, see the architecture design doc §19). Disabled by default
 * so a Product Detail page can render its cheap sections first and only
 * fetch insights when the caller explicitly enables it (e.g. once the tab
 * is opened) — never blocks the rest of the page.
 */
export function useProductInsights(platform: Platform, sourceProductId: string, window: NamedWindow, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.productInsights(platform, sourceProductId, window),
    queryFn: ({ signal }) => getProductInsights(platform, sourceProductId, window, signal),
    enabled,
    retry: false, // an AI-provider failure shouldn't be silently retried against a real, possibly billable, provider
  });
}
