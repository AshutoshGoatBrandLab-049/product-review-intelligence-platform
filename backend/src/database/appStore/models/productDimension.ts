import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

export class ProductDimension extends Model<
  InferAttributes<ProductDimension>,
  InferCreationAttributes<ProductDimension>
> {
  declare platform: "flipkart" | "myntra";
  declare sourceProductId: string;
  declare brand: string | null;
  declare brandInconsistent: CreationOptional<boolean>;
  declare productUrl: string | null;
  declare firstReviewDate: string;
  declare lastReviewDate: string;
  declare totalReviewCount: number;
  declare lastRebuiltAt: CreationOptional<Date>;
}

ProductDimension.init(
  {
    platform: { type: DataTypes.TEXT, primaryKey: true },
    sourceProductId: { type: DataTypes.TEXT, primaryKey: true, field: "source_product_id" },
    brand: { type: DataTypes.TEXT, allowNull: true },
    brandInconsistent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "brand_inconsistent" },
    productUrl: { type: DataTypes.TEXT, allowNull: true, field: "product_url" },
    firstReviewDate: { type: DataTypes.DATEONLY, allowNull: false, field: "first_review_date" },
    lastReviewDate: { type: DataTypes.DATEONLY, allowNull: false, field: "last_review_date" },
    totalReviewCount: { type: DataTypes.INTEGER, allowNull: false, field: "total_review_count" },
    lastRebuiltAt: { type: DataTypes.DATE, allowNull: false, field: "last_rebuilt_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "product_dimension",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
