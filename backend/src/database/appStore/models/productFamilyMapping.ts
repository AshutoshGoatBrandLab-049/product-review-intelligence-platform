import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

/**
 * Phase 5 Step 6 — the sole persisted table this sub-phase introduces (see
 * migration 012's comment for why). Starts empty; populating it is a
 * separate, deliberate, business-provided decision, not something this
 * application ever infers or fuzzy-matches on its own.
 */
export class ProductFamilyMapping extends Model<InferAttributes<ProductFamilyMapping>, InferCreationAttributes<ProductFamilyMapping>> {
  declare familyId: CreationOptional<string>;
  declare flipkartSourceProductId: string;
  declare myntraSourceProductId: string;
  declare notes: string | null;
  declare createdAt: CreationOptional<Date>;
}

ProductFamilyMapping.init(
  {
    familyId: { type: DataTypes.UUIDV4, primaryKey: true, defaultValue: DataTypes.UUIDV4, field: "family_id" },
    flipkartSourceProductId: { type: DataTypes.TEXT, allowNull: false, unique: true, field: "flipkart_source_product_id" },
    myntraSourceProductId: { type: DataTypes.TEXT, allowNull: false, unique: true, field: "myntra_source_product_id" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "product_family_mapping",
    schema: config.appStore.schema,
    timestamps: false,
  },
);
