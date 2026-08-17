import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

export type AiRunStatus = "running" | "success" | "partial_failure" | "failed";

export class AiProcessingRun extends Model<InferAttributes<AiProcessingRun>, InferCreationAttributes<AiProcessingRun>> {
  declare id: CreationOptional<string>;
  declare jobId: string;
  declare platform: string | null;
  declare provider: string;
  declare modelVersion: string;
  declare dryRun: CreationOptional<boolean>;
  declare candidateCount: CreationOptional<number>;
  declare alreadyClassifiedCount: CreationOptional<number>;
  declare staleCount: CreationOptional<number>;
  declare newCount: CreationOptional<number>;
  declare processedCount: CreationOptional<number>;
  declare successCount: CreationOptional<number>;
  declare failureCount: CreationOptional<number>;
  declare retryCount: CreationOptional<number>;
  declare startedAt: CreationOptional<Date>;
  declare finishedAt: Date | null;
  declare durationMs: number | null;
  declare status: AiRunStatus;
}

AiProcessingRun.init(
  {
    id: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    jobId: { type: DataTypes.TEXT, allowNull: false, field: "job_id" },
    platform: { type: DataTypes.TEXT, allowNull: true },
    provider: { type: DataTypes.TEXT, allowNull: false },
    modelVersion: { type: DataTypes.TEXT, allowNull: false, field: "model_version" },
    dryRun: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "dry_run" },
    candidateCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "candidate_count" },
    alreadyClassifiedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "already_classified_count" },
    staleCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "stale_count" },
    newCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "new_count" },
    processedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "processed_count" },
    successCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "success_count" },
    failureCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "failure_count" },
    retryCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "retry_count" },
    startedAt: { type: DataTypes.DATE, allowNull: false, field: "started_at", defaultValue: DataTypes.NOW },
    finishedAt: { type: DataTypes.DATE, allowNull: true, field: "finished_at" },
    durationMs: { type: DataTypes.INTEGER, allowNull: true, field: "duration_ms" },
    status: { type: DataTypes.TEXT, allowNull: false },
  },
  {
    sequelize: appSequelize,
    tableName: "ai_processing_runs",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
