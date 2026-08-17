import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

/**
 * Catches content-drift-under-same-ID (Flipkart collision symptoms). Does
 * NOT catch the inverse — one review resolving to two different
 * canonical_review_ids over time (Phase 1 plan §G) — that failure mode
 * manifests as an unexplained near-duplicate row, not a hash mismatch, and
 * has no detection mechanism in Phase 1.
 */
export class IdentityAnomaly extends Model<
  InferAttributes<IdentityAnomaly>,
  InferCreationAttributes<IdentityAnomaly>
> {
  declare anomalyId: CreationOptional<string>;
  declare canonicalReviewId: string;
  declare platform: string;
  declare previousContentHash: string;
  declare newContentHash: string;
  declare readonly detectedAt: CreationOptional<Date>;
}

IdentityAnomaly.init(
  {
    anomalyId: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4, field: "anomaly_id" },
    canonicalReviewId: { type: DataTypes.CHAR(32), allowNull: false, field: "canonical_review_id" },
    platform: { type: DataTypes.TEXT, allowNull: false },
    previousContentHash: { type: DataTypes.CHAR(64), allowNull: false, field: "previous_content_hash" },
    newContentHash: { type: DataTypes.CHAR(64), allowNull: false, field: "new_content_hash" },
    detectedAt: { type: DataTypes.DATE, allowNull: false, field: "detected_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "identity_anomalies",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
