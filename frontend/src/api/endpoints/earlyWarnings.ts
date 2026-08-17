import { apiGet } from "../client";
import type { EarlyWarningsResponse, NamedWindow, Platform } from "@/types/api";

export interface EarlyWarningsFilters {
  [key: string]: unknown;
  window: NamedWindow;
  platform?: Platform;
  brand?: string;
}

export function getEarlyWarnings(filters: EarlyWarningsFilters, signal?: AbortSignal) {
  return apiGet<EarlyWarningsResponse>("/v1/early-warnings", { query: filters, signal });
}
