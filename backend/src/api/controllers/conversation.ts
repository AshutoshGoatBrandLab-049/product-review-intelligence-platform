import type { Request, Response } from "express";
import { getOrCreateConversation, getConversation, listConversations as listAllConversations } from "../../modules/ai/conversationStore.js";
import { getValidatedParams } from "../middleware/validate.js";
import type { ProductParams } from "../schemas.js";
import { resolveNamedWindow } from "../../modules/analytics/dateWindows.js";
import type { NamedWindow } from "../../modules/analytics/dateWindows.js";

/**
 * Phase 10 Step 2 — Team conversation endpoints.
 * Conversations are shared across authorized team members by product+window.
 * createdBy is audit metadata only, not an access control gate.
 */

export async function getOrCreateProductConversation(req: Request, res: Response): Promise<void> {
  const { platform, sourceProductId } = getValidatedParams<ProductParams>(req);
  const window = req.query.window as NamedWindow | undefined;
  const resolvedWindow = resolveNamedWindow(window ?? "30d");

  // Current user for audit trail
  const createdBy = (req as any).user?.sub;

  const conversation = await getOrCreateConversation(platform, sourceProductId, resolvedWindow, createdBy);

  res.json({
    id: conversation.id,
    platform: conversation.platform,
    sourceProductId: conversation.sourceProductId,
    windowStart: conversation.windowStart,
    windowEnd: conversation.windowEnd,
    messages: conversation.messages,
    createdBy: conversation.createdBy,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });
}

export async function getConversationDetails(req: Request, res: Response): Promise<void> {
  const conversationId = req.params.conversationId as string;

  const conversation = await getConversation(conversationId);

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json({
    id: conversation.id,
    platform: conversation.platform,
    sourceProductId: conversation.sourceProductId,
    windowStart: conversation.windowStart,
    windowEnd: conversation.windowEnd,
    messages: conversation.messages,
    createdBy: conversation.createdBy,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });
}

export async function listConversations(req: Request, res: Response): Promise<void> {
  const conversations = await listAllConversations();

  res.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      platform: c.platform,
      sourceProductId: c.sourceProductId,
      windowStart: c.windowStart,
      windowEnd: c.windowEnd,
      messageCount: c.messages?.length ?? 0,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}
