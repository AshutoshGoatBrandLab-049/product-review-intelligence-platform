import type { Pool } from "pg";
import type { RawMyntraReview } from "../../types/unifiedReview.js";
import { config } from "../../config/index.js";

const TABLE = `"${config.prodReadOnly.schema}".myntra_reviews`;

const COLUMNS = `
  id, product_id, review_id, brand_name, rating, title, body, review_date,
  reviewed_at, author_name, helpful_count, not_helpful_count, has_images,
  image_urls, size_purchased, color_purchased, product_url, country,
  "updatedAt"
`;

/** Track A: new-row keyset scan, ordered by the indexed primary key. */
export async function getMyntraReviewsPage(
  pool: Pool,
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${TABLE} WHERE id > $1 ORDER BY id LIMIT $2`,
    [afterId, limit],
  );
  return rows;
}

/** Track B: bounded reconciliation window, ordered by id for stable chunking. */
export async function getMyntraReviewsByDateWindow(
  pool: Pool,
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${TABLE}
     WHERE review_date >= $1 AND id > $2
     ORDER BY id LIMIT $3`,
    [windowStart, afterId, limit],
  );
  return rows;
}
