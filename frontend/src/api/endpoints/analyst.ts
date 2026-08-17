import { apiGet } from "../client";
import type { NamedWindow, Platform } from "@/types/api";

export interface ProductAnalystResponse {
  platform: Platform;
  sourceProductId: string;
  window: {start: string; end: string};
  userQuestion: string;
  answer: string;
  analysis: any;
  cacheHit: boolean;
}

export function analyzeProductQuestion(
  platform: Platform,
  sourceProductId: string,
  question: string,
  window?: NamedWindow,
  signal?: AbortSignal,
) {
  const query: Record<string, string> = { question };
  if (window) query.window = window;

  return apiGet<ProductAnalystResponse>(
    `/v1/ai/products/${platform}/${encodeURIComponent(sourceProductId)}/analysis`,
    { query, signal },
  );
}
