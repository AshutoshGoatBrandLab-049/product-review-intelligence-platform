import { apiGet } from "../client";
import type { AiUsageResponse, IngestionStatusResponse } from "@/types/api";

export function getIngestionStatus(signal?: AbortSignal) {
  return apiGet<IngestionStatusResponse>("/v1/system/ingestion-status", { signal });
}

export function getAiUsage(signal?: AbortSignal) {
  return apiGet<AiUsageResponse>("/v1/system/ai-usage", { signal });
}
