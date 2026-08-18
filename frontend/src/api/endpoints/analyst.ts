import { apiGet } from "../client";
import type { NamedWindow, Platform, ProductAnalystResponse } from "@/types/api";

export type { ProductAnalystResponse };

export function analyzeProductQuestion(
  platform: Platform,
  sourceProductId: string,
  question: string,
  window?: NamedWindow,
  conversationId?: string,
  signal?: AbortSignal,
) {
  const query: Record<string, string> = { question };
  if (window) query.window = window;
  if (conversationId) query.conversationId = conversationId;

  return apiGet<ProductAnalystResponse>(
    `/v1/ai/products/${platform}/${encodeURIComponent(sourceProductId)}/analysis`,
    { query, signal },
  );
}
