import { appSequelize } from "../../database/appStore/client.js";
import { AiConversation, type ConversationMessage } from "../../database/appStore/models/aiConversation.js";
import type { DateWindow } from "../analytics/dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 10 Step 2 — Team-shared conversation persistence layer.
 * Handles conversation lifecycle for shared product investigations.
 * One conversation per (platform, sourceProductId) — visible to all authorized team members.
 * Window/scope is determined from each question's natural language, not from UI selector.
 * createdBy is audit metadata, not an access control gate.
 */

/**
 * Get or create a conversation for a product.
 * Ensures exactly one conversation per (platform, sourceProductId).
 * All authorized team members see the same conversation.
 * Questions within this conversation may reference different time windows/scopes,
 * determined from the natural language of each question.
 */
export async function getOrCreateConversation(
  platform: Platform,
  sourceProductId: string,
  createdBy?: string,  // Current user for audit trail (optional)
): Promise<AiConversation> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const [conversation] = await AiConversation.findOrCreate({
    where: {
      platform,
      sourceProductId,
    },
    defaults: {
      platform,
      sourceProductId,
      windowStart: yesterday.toISOString().split('T')[0], // YYYY-MM-DD format
      windowEnd: today.toISOString().split('T')[0], // YYYY-MM-DD format
      createdBy: createdBy || null,
      messages: [],
    },
  });

  return conversation;
}

/**
 * Append a message to an existing conversation.
 * Messages are stored as JSONB array; this appends the new message.
 */
export async function appendConversationMessage(
  conversationId: string,
  message: ConversationMessage,
): Promise<void> {
  const { QueryTypes } = await import("sequelize");
  const { config } = await import("../../config/index.js");
  const schema = config.appStore.schema;

  await appSequelize.query(
    `UPDATE "${schema}".ai_product_analyst_conversations
     SET messages = messages || :newMessage::jsonb, updated_at = NOW()
     WHERE id = :conversationId`,
    {
      replacements: {
        conversationId,
        newMessage: JSON.stringify([message]),
      },
      type: QueryTypes.UPDATE,
    },
  );
}

/**
 * Get a conversation by ID (team-visible, no user gate).
 */
export async function getConversation(conversationId: string): Promise<AiConversation | null> {
  return AiConversation.findOne({
    where: {
      id: conversationId,
    },
  });
}

/**
 * List all conversations (team-visible product investigations).
 */
export async function listConversations(): Promise<AiConversation[]> {
  return AiConversation.findAll({
    order: [["updatedAt", "DESC"]],
  });
}
