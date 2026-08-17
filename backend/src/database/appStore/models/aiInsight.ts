import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

/**
 * Phase 6 Step 2 — the only new persisted table this phase introduces.
 * Caches validated narrator output only; never raw/unvalidated AI output.
 * See migration 013's comment for the full cache-key rationale.
 */
export class AiInsight extends Model<InferAttributes<AiInsight>, InferCreationAttributes<AiInsight>> {
  declare id: CreationOptional<string>;
  declare platform: "flipkart" | "myntra";
  declare sourceProductId: string;
  declare windowStart: string;
  declare windowEnd: string;
  declare inputHash: string;
  declare result: object;
  declare modelVersion: string;
  declare createdAt: CreationOptional<Date>;
}

AiInsight.init(
  {
    id: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    platform: { type: DataTypes.TEXT, allowNull: false },
    sourceProductId: { type: DataTypes.TEXT, allowNull: false, field: "source_product_id" },
    windowStart: { type: DataTypes.DATEONLY, allowNull: false, field: "window_start" },
    windowEnd: { type: DataTypes.DATEONLY, allowNull: false, field: "window_end" },
    inputHash: { type: DataTypes.CHAR(64), allowNull: false, field: "input_hash" },
    result: { type: DataTypes.JSONB, allowNull: false },
    modelVersion: { type: DataTypes.TEXT, allowNull: false, field: "model_version" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "ai_insights",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
