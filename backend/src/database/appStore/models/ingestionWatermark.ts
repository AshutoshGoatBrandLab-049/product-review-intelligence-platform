import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

export class IngestionWatermark extends Model<
  InferAttributes<IngestionWatermark>,
  InferCreationAttributes<IngestionWatermark>
> {
  declare platform: "flipkart" | "myntra";
  declare lastSeenSourceId: number;
  declare lastReconciliationRunAt: Date | null;
  declare lastReconciliationRowsScanned: number | null;
  declare lastReconciliationRowsChanged: number | null;
  declare status: "idle" | "running";
  declare lockAcquiredAt: Date | null;
  declare readonly updatedAt: CreationOptional<Date>;
}

IngestionWatermark.init(
  {
    platform: { type: DataTypes.TEXT, primaryKey: true },
    lastSeenSourceId: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0, field: "last_seen_source_id" },
    lastReconciliationRunAt: { type: DataTypes.DATE, allowNull: true, field: "last_reconciliation_run_at" },
    lastReconciliationRowsScanned: { type: DataTypes.INTEGER, allowNull: true, field: "last_reconciliation_rows_scanned" },
    lastReconciliationRowsChanged: { type: DataTypes.INTEGER, allowNull: true, field: "last_reconciliation_rows_changed" },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: "idle" },
    lockAcquiredAt: { type: DataTypes.DATE, allowNull: true, field: "lock_acquired_at" },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "ingestion_watermarks",
    schema: config.appStore.schema,
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
  },
);
