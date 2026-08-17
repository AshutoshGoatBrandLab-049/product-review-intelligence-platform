import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";
import type { FailedFields } from "../../../modules/ingestion/shared/validators.js";

export class IngestionReject extends Model<
  InferAttributes<IngestionReject>,
  InferCreationAttributes<IngestionReject>
> {
  declare rejectId: CreationOptional<string>;
  declare platform: string;
  declare sourceRowId: number | null;
  declare sourceProductId: string | null;
  declare sourceReviewId: string | null;
  declare reason: string;
  declare failedFields: FailedFields;
  declare firstSeenAt: CreationOptional<Date>;
  declare lastSeenAt: CreationOptional<Date>;
  declare occurrenceCount: CreationOptional<number>;
}

IngestionReject.init(
  {
    rejectId: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4, field: "reject_id" },
    platform: { type: DataTypes.TEXT, allowNull: false },
    sourceRowId: { type: DataTypes.BIGINT, allowNull: true, field: "source_row_id" },
    sourceProductId: { type: DataTypes.TEXT, allowNull: true, field: "source_product_id" },
    sourceReviewId: { type: DataTypes.TEXT, allowNull: true, field: "source_review_id" },
    reason: { type: DataTypes.TEXT, allowNull: false },
    failedFields: { type: DataTypes.JSONB, allowNull: false, field: "failed_fields" },
    firstSeenAt: { type: DataTypes.DATE, allowNull: false, field: "first_seen_at", defaultValue: DataTypes.NOW },
    lastSeenAt: { type: DataTypes.DATE, allowNull: false, field: "last_seen_at", defaultValue: DataTypes.NOW },
    occurrenceCount: { type: DataTypes.INTEGER, allowNull: false, field: "occurrence_count", defaultValue: 1 },
  },
  {
    sequelize: appSequelize,
    tableName: "ingestion_rejects",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
