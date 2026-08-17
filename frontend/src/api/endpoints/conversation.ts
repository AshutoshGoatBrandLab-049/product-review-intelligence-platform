import { apiGet } from "../client";
import type { ConversationResponse, Platform, NamedWindow } from "@/types/api";

export function getOrCreateConversation(
  platform: Platform,
  sourceProductId: string,
  window?: NamedWindow,
  signal?: AbortSignal,
) {
  const query: Record<string, string> = {};
  if (window) query.window = window;

  return apiGet<ConversationResponse>(
    `/v1/ai/products/${platform}/${encodeURIComponent(sourceProductId)}/conversation`,
    { query, signal },
  );
}

export function getConversationById(conversationId: string, signal?: AbortSignal) {
  return apiGet<ConversationResponse>(`/v1/ai/conversations/${conversationId}`, { signal });
}

export function listConversations(signal?: AbortSignal) {
  return apiGet<{ conversations: Array<Omit<ConversationResponse, "messages"> & { messageCount: number }> }>(
    `/v1/ai/conversations`,
    { signal },
  );
}
