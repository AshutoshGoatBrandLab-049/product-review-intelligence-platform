import { apiGet } from "../client";
import type { DashboardExecutiveResponse, NamedWindow } from "@/types/api";

export function getExecutiveDashboard(window: NamedWindow, signal?: AbortSignal) {
  return apiGet<DashboardExecutiveResponse>("/v1/dashboard/executive", { query: { window }, signal });
}
