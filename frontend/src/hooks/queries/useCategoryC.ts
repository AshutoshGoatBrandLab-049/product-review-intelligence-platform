import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getEarlyWarnings, type EarlyWarningsFilters } from "@/api/endpoints/earlyWarnings";
import { getExecutiveDashboard } from "@/api/endpoints/dashboard";
import { getProductRankings, type RankingsFilters } from "@/api/endpoints/rankings";
import { getProblems, type ProblemsFilters } from "@/api/endpoints/problems";
import { queryKeys } from "@/api/queryKeys";
import type { NamedWindow } from "@/types/api";

/**
 * Phase 7 Step 1 — the backend already caches these four endpoints
 * server-side for 60s (Category C, Phase 6 §4 of the architecture design
 * doc). This staleTime is deliberately shorter than that, not a second
 * copy of it: its only job is to dedupe rapid re-renders/refocus events
 * within the same short window, then defer entirely to whatever the server
 * returns (including its own `cacheHit` flag) as the real freshness signal.
 */
const CATEGORY_C_STALE_TIME_MS = 15_000;

export function useEarlyWarnings(filters: EarlyWarningsFilters) {
  return useQuery({
    queryKey: queryKeys.earlyWarnings(filters.window, filters.platform, filters.brand),
    queryFn: ({ signal }) => getEarlyWarnings(filters, signal),
    staleTime: CATEGORY_C_STALE_TIME_MS,
    // Phase 7 Step 2 §13: keep showing the previous window's data while a
    // new window is loading, instead of flashing back to a blank/skeleton
    // page — the cold-cache request can take ~2.3s at real catalog scale.
    placeholderData: keepPreviousData,
  });
}

export function useExecutiveDashboard(window: NamedWindow) {
  return useQuery({
    queryKey: queryKeys.dashboard(window),
    queryFn: ({ signal }) => getExecutiveDashboard(window, signal),
    staleTime: CATEGORY_C_STALE_TIME_MS,
    placeholderData: keepPreviousData,
  });
}

export function useProductRankings(filters: RankingsFilters) {
  return useQuery({
    queryKey: queryKeys.rankings(filters.window, filters.sort, filters.platform, filters.brand, filters.page, filters.pageSize),
    queryFn: ({ signal }) => getProductRankings(filters, signal),
    staleTime: CATEGORY_C_STALE_TIME_MS,
    // Phase 7 Step 4: keep showing the previous page/sort/filter's data
    // while the new combination loads, instead of flashing back to skeletons.
    placeholderData: keepPreviousData,
  });
}

export function useProblems(filters: ProblemsFilters) {
  return useQuery({
    queryKey: queryKeys.problems(filters.window, filters.platform, filters.theme),
    queryFn: ({ signal }) => getProblems(filters, signal),
    staleTime: CATEGORY_C_STALE_TIME_MS,
    // Phase 7 Step 6: same rationale as the other three Category C hooks —
    // keep showing the previous filter combination's data while a new one
    // loads, instead of flashing back to skeletons.
    placeholderData: keepPreviousData,
  });
}
