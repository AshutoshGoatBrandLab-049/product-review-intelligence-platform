import { apiGet } from "../client";
import type { NamedWindow, Platform, ProblemsResponse, Theme } from "@/types/api";

export interface ProblemsFilters {
  [key: string]: unknown;
  window: NamedWindow;
  platform?: Platform;
  theme?: Theme;
}

export function getProblems(filters: ProblemsFilters, signal?: AbortSignal) {
  return apiGet<ProblemsResponse>("/v1/problems", { query: filters, signal });
}
