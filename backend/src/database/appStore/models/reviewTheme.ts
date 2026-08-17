import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

export const THEME_VOCABULARY = [
  "quality", "size", "fit", "comfort", "color", "durability",
  "packaging", "delivery", "value", "material", "product_mismatch",
] as const;
export type Theme = (typeof THEME_VOCABULARY)[number];

/**
 * Phase 3 §11/§15 — theme FOUNDATION. No row is ever written by any Phase 3
 * code. Controlled vocabulary only (THEME_VOCABULARY), never free text, so
 * every future theme claim is checkable against a fixed list.
 */
export class ReviewTheme extends Model<InferAttributes<ReviewTheme>, InferCreationAttributes<ReviewTheme>> {
  declare id: CreationOptional<string>;
  declare canonicalReviewId: string;
  declare theme: Theme;
  declare evidenceSnippet: string | null;
  declare confidence: number;
  declare modelVersion: string;
  declare extractedAt: CreationOptional<Date>;
  declare contentHashAtExtraction: string;
}

ReviewTheme.init(
  {
    id: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    canonicalReviewId: { type: DataTypes.CHAR(32), allowNull: false, field: "canonical_review_id" },
    theme: { type: DataTypes.TEXT, allowNull: false },
    evidenceSnippet: { type: DataTypes.TEXT, allowNull: true, field: "evidence_snippet" },
    confidence: { type: DataTypes.REAL, allowNull: false },
    modelVersion: { type: DataTypes.TEXT, allowNull: false, field: "model_version" },
    extractedAt: { type: DataTypes.DATE, allowNull: false, field: "extracted_at", defaultValue: DataTypes.NOW },
    contentHashAtExtraction: { type: DataTypes.CHAR(64), allowNull: false, field: "content_hash_at_extraction" },
  },
  {
    sequelize: appSequelize,
    tableName: "review_theme",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
