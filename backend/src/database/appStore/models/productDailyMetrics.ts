import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

export class ProductDailyMetrics extends Model<
  InferAttributes<ProductDailyMetrics>,
  InferCreationAttributes<ProductDailyMetrics>
> {
  declare platform: "flipkart" | "myntra";
  declare sourceProductId: string;
  declare reviewDate: string;
  declare reviewCount: number;
  declare ratingSum: number;
  declare rating1Count: CreationOptional<number>;
  declare rating2Count: CreationOptional<number>;
  declare rating3Count: CreationOptional<number>;
  declare rating4Count: CreationOptional<number>;
  declare rating5Count: CreationOptional<number>;
  declare positiveCount: CreationOptional<number>;
  declare negativeCount: CreationOptional<number>;
  declare neutralCount: CreationOptional<number>;
  declare helpfulCountSum: CreationOptional<number>;
  declare lastRebuiltAt: CreationOptional<Date>;
}

ProductDailyMetrics.init(
  {
    platform: { type: DataTypes.TEXT, primaryKey: true },
    sourceProductId: { type: DataTypes.TEXT, primaryKey: true, field: "source_product_id" },
    reviewDate: { type: DataTypes.DATEONLY, primaryKey: true, field: "review_date" },
    reviewCount: { type: DataTypes.INTEGER, allowNull: false, field: "review_count" },
    ratingSum: { type: DataTypes.INTEGER, allowNull: false, field: "rating_sum" },
    rating1Count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rating_1_count" },
    rating2Count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rating_2_count" },
    rating3Count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rating_3_count" },
    rating4Count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rating_4_count" },
    rating5Count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "rating_5_count" },
    positiveCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "positive_count" },
    negativeCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "negative_count" },
    neutralCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "neutral_count" },
    helpfulCountSum: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "helpful_count_sum" },
    lastRebuiltAt: { type: DataTypes.DATE, allowNull: false, field: "last_rebuilt_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "product_daily_metrics",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
