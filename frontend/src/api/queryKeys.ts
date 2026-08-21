import type { DateRange } from "@/components/intelligence/DateRangeSelector";
import type { NamedWindow, Platform, RankingsSort, Theme } from "@/types/api";

/**
 * Phase 7 Step 1 — one query-key factory, so every hook builds keys the
 * same predictable way (TanStack Query invalidation/dedup depends on key
 * shape being consistent). Keys mirror the actual query params each
 * endpoint accepts (Phase 6 §3/§7 of the architecture design doc) — no key
 * includes a filter the backend doesn't support.
 */
export const queryKeys = {
  productDetail: (platform: Platform, sourceProductId: string, range: DateRange) => ["product", platform, sourceProductId, range.from, range.to] as const,
  productSignals: (platform: Platform, sourceProductId: string, range: DateRange) => ["signals", platform, sourceProductId, range.from, range.to] as const,
  productInsights: (platform: Platform, sourceProductId: string, range: DateRange) => ["insights", platform, sourceProductId, range.from, range.to] as const,
  brandComparison: (brand: string, window: NamedWindow) => ["brandComparison", brand, window] as const,
  familyComparison: (familyId: string, window: NamedWindow) => ["familyComparison", familyId, window] as const,
  earlyWarnings: (window: NamedWindow, platform?: Platform, brand?: string) => ["earlyWarnings", window, platform, brand] as const,
  dashboard: (window: NamedWindow) => ["dashboard", window] as const,
  rankings: (window: NamedWindow, sort: RankingsSort, platform: Platform | undefined, brand: string | undefined, page: number, pageSize: number) =>
    ["rankings", window, sort, platform, brand, page, pageSize] as const,
  problems: (window: NamedWindow, platform?: Platform, theme?: Theme) => ["problems", window, platform, theme] as const,
  evidenceReviews: (canonicalReviewIds: string[]) => ["evidenceReviews", ...canonicalReviewIds.sort()] as const,
  ingestionStatus: () => ["ingestionStatus"] as const,
  aiUsage: () => ["aiUsage"] as const,
};
