import { apiGet } from "../client";
import type { NamedWindow, Platform, RankingsResponse, RankingsSort } from "@/types/api";

export interface RankingsFilters {
  [key: string]: unknown;
  window: NamedWindow;
  sort: RankingsSort;
  platform?: Platform;
  brand?: string;
  page: number;
  pageSize: number;
}

export function getProductRankings(filters: RankingsFilters, signal?: AbortSignal) {
  return apiGet<RankingsResponse>("/v1/products/rankings", { query: filters, signal });
}
