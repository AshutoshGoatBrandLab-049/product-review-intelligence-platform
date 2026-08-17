import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

/**
 * Phase 3 §10/§15 — sentiment FOUNDATION. No row is ever written by any
 * Phase 3 code; this model exists so Phase 4+ classification work has a
 * stable target, per the approved design.
 */
export class ReviewSentiment extends Model<
  InferAttributes<ReviewSentiment>,
  InferCreationAttributes<ReviewSentiment>
> {
  declare canonicalReviewId: string;
  declare label: "positive" | "neutral" | "negative";
  declare confidence: number;
  declare modelVersion: string;
  declare classifiedAt: CreationOptional<Date>;
  declare contentHashAtClassification: string;
}

ReviewSentiment.init(
  {
    canonicalReviewId: { type: DataTypes.CHAR(32), primaryKey: true, field: "canonical_review_id" },
    label: { type: DataTypes.TEXT, allowNull: false },
    confidence: { type: DataTypes.REAL, allowNull: false },
    modelVersion: { type: DataTypes.TEXT, allowNull: false, field: "model_version" },
    classifiedAt: { type: DataTypes.DATE, allowNull: false, field: "classified_at", defaultValue: DataTypes.NOW },
    contentHashAtClassification: { type: DataTypes.CHAR(64), allowNull: false, field: "content_hash_at_classification" },
  },
  {
    sequelize: appSequelize,
    tableName: "review_sentiment",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
