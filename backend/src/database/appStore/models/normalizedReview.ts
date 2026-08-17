import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { appSequelize } from "../client.js";
import { config } from "../../../config/index.js";

export class NormalizedReview extends Model<
  InferAttributes<NormalizedReview>,
  InferCreationAttributes<NormalizedReview>
> {
  declare canonicalReviewId: string;
  declare platform: "flipkart" | "myntra";
  declare sourceProductId: string;
  declare sourceReviewId: string;
  declare sourceRowId: number;
  declare identityConfidence: "native" | "derived";

  declare brand: string | null;
  declare rating: number;
  declare title: string | null;
  declare reviewText: string | null;
  declare author: string | null;
  declare helpfulCount: number | null;
  declare notHelpfulCount: number | null;
  declare country: string | null;
  declare productUrl: string | null;

  declare reviewDate: string;
  declare reviewTimestamp: Date | null;
  declare dateConfidence: "exact" | "day" | "month";

  declare verifiedPurchase: boolean | null;
  declare hasImages: boolean | null;
  declare imageUrls: string[] | null;
  declare sizePurchased: string | null;
  declare colorPurchased: string | null;

  declare contentHash: string;
  declare sourceUpdatedAt: Date;
  declare sourceExtra: Record<string, unknown> | null;
  declare mapperVersion: number;

  declare ingestedAt: CreationOptional<Date>;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

NormalizedReview.init(
  {
    canonicalReviewId: { type: DataTypes.CHAR(32), primaryKey: true, field: "canonical_review_id" },
    platform: { type: DataTypes.TEXT, allowNull: false },
    sourceProductId: { type: DataTypes.TEXT, allowNull: false, field: "source_product_id" },
    sourceReviewId: { type: DataTypes.TEXT, allowNull: false, field: "source_review_id" },
    sourceRowId: { type: DataTypes.BIGINT, allowNull: false, field: "source_row_id" },
    identityConfidence: { type: DataTypes.TEXT, allowNull: false, field: "identity_confidence" },

    brand: { type: DataTypes.TEXT, allowNull: true },
    rating: { type: DataTypes.SMALLINT, allowNull: false },
    title: { type: DataTypes.TEXT, allowNull: true },
    reviewText: { type: DataTypes.TEXT, allowNull: true, field: "review_text" },
    author: { type: DataTypes.TEXT, allowNull: true },
    helpfulCount: { type: DataTypes.INTEGER, allowNull: true, field: "helpful_count" },
    notHelpfulCount: { type: DataTypes.INTEGER, allowNull: true, field: "not_helpful_count" },
    country: { type: DataTypes.TEXT, allowNull: true },
    productUrl: { type: DataTypes.TEXT, allowNull: true, field: "product_url" },

    reviewDate: { type: DataTypes.DATEONLY, allowNull: false, field: "review_date" },
    reviewTimestamp: { type: DataTypes.DATE, allowNull: true, field: "review_timestamp" },
    dateConfidence: { type: DataTypes.TEXT, allowNull: false, field: "date_confidence" },

    verifiedPurchase: { type: DataTypes.BOOLEAN, allowNull: true, field: "verified_purchase" },
    hasImages: { type: DataTypes.BOOLEAN, allowNull: true, field: "has_images" },
    imageUrls: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true, field: "image_urls" },
    sizePurchased: { type: DataTypes.TEXT, allowNull: true, field: "size_purchased" },
    colorPurchased: { type: DataTypes.TEXT, allowNull: true, field: "color_purchased" },

    contentHash: { type: DataTypes.CHAR(64), allowNull: false, field: "content_hash" },
    sourceUpdatedAt: { type: DataTypes.DATE, allowNull: false, field: "source_updated_at" },
    sourceExtra: { type: DataTypes.JSONB, allowNull: true, field: "source_extra" },
    mapperVersion: { type: DataTypes.INTEGER, allowNull: false, field: "mapper_version" },

    ingestedAt: { type: DataTypes.DATE, allowNull: false, field: "ingested_at", defaultValue: DataTypes.NOW },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at", defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at", defaultValue: DataTypes.NOW },
  },
  {
    sequelize: appSequelize,
    tableName: "normalized_reviews",
    schema: config.appStore.schema,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ unique: true, fields: ["platform", "source_product_id", "source_review_id"] }],
  },
);
