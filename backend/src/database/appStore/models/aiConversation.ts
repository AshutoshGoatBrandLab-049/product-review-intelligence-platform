import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";
import type { NarratorResult } from "../../../modules/ai/narrator.js";

export interface ConversationMessage {
  role: "user" | "ai";
  content: string;
  timestamp: string;
  analysis?: NarratorResult;
  /**
   * Phase 10 AI Product Analyst intent/context correction — additive
   * metadata (JSONB column, no migration) so the NEXT turn can resolve
   * ambiguous/anaphoric follow-ups ("show me", "show those", "why?")
   * against real prior state instead of reclassifying blind.
   */
  intent?: string;
  aspect?: string;
  reviewIds?: string[];
}

export class AiConversation extends Model<InferAttributes<AiConversation>, InferCreationAttributes<AiConversation>> {
  declare id: CreationOptional<string>;
  declare platform: "flipkart" | "myntra";
  declare sourceProductId: string;
  declare windowStart: string;
  declare windowEnd: string;
  declare createdBy: string | null;
  declare messages: ConversationMessage[];
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AiConversation.init(
  {
    id: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    platform: { type: DataTypes.TEXT, allowNull: false },
    sourceProductId: { type: DataTypes.TEXT, allowNull: false, field: "source_product_id" },
    windowStart: { type: DataTypes.DATEONLY, allowNull: false, field: "window_start" },
    windowEnd: { type: DataTypes.DATEONLY, allowNull: false, field: "window_end" },
    createdBy: { type: DataTypes.TEXT, allowNull: true, field: "created_by" },
    messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at", defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "ai_product_analyst_conversations",
    schema: config.appStore.schema,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);
