import { appSequelize } from "../appStore/client.js";
import { QueryTypes } from "sequelize";
import type { RawMyntraReview } from "../../types/unifiedReview.js";
import { config } from "../../config/index.js";

const TABLE = `"${config.appStore.schema}".myntra_reviews`;

const COLUMNS = `
  id, product_id, review_id, brand_name, rating, title, body, review_date,
  reviewed_at, author_name, helpful_count, not_helpful_count, has_images,
  image_urls, size_purchased, color_purchased, product_url, country,
  "updatedAt"
`;

/** Track A: new-row keyset scan, ordered by the indexed primary key. */
export async function getMyntraReviewsPage(
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  const rows = await appSequelize.query<RawMyntraReview>(
    `SELECT ${COLUMNS} FROM ${TABLE} WHERE id > :afterId ORDER BY id LIMIT :limit`,
    {
      replacements: { afterId, limit },
      type: QueryTypes.SELECT,
    },
  );
  return rows;
}

/** Track B: bounded reconciliation window, ordered by id for stable chunking. */
export async function getMyntraReviewsByDateWindow(
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  const rows = await appSequelize.query<RawMyntraReview>(
    `SELECT ${COLUMNS} FROM ${TABLE}
     WHERE review_date >= :windowStart AND id > :afterId
     ORDER BY id LIMIT :limit`,
    {
      replacements: { windowStart, afterId, limit },
      type: QueryTypes.SELECT,
    },
  );
  return rows;
}
