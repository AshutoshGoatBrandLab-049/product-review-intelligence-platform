import type { Pool } from "pg";
import type { RawFlipkartReview } from "../../types/unifiedReview.js";
import { config } from "../../config/index.js";

/**
 * Every query in this file is a fixed, hardcoded literal referencing exactly
 * "DataWarehouse".flipkart_reviews — never a table name built from a
 * variable, never a generic query executor. This is what makes "cannot
 * access an unauthorized table" a structural, testable property.
 */
const TABLE = `"${config.prodReadOnly.schema}".flipkart_reviews`;

const COLUMNS = `
  id, pid, review_id, brand_name, rating, title, comment, review_date,
  product_url, author_name, verified_purchase, helpful_count, country,
  "updatedAt"
`;

/** Track A: new-row keyset scan, ordered by the indexed primary key. */
export async function getFlipkartReviewsPage(
  pool: Pool,
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${TABLE} WHERE id > $1 ORDER BY id LIMIT $2`,
    [afterId, limit],
  );
  return rows;
}

/** Track B: bounded reconciliation window, ordered by id for stable chunking. */
export async function getFlipkartReviewsByDateWindow(
  pool: Pool,
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${TABLE}
     WHERE review_date >= $1 AND id > $2
     ORDER BY id LIMIT $3`,
    [windowStart, afterId, limit],
  );
  return rows;
}
