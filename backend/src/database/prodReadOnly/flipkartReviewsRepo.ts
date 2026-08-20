import { appSequelize } from "../appStore/client.js";
import { QueryTypes } from "sequelize";
import type { RawFlipkartReview } from "../../types/unifiedReview.js";
import { config } from "../../config/index.js";

/**
 * Every query in this file is a fixed, hardcoded literal referencing exactly
 * "DataWarehouse".flipkart_reviews — never a table name built from a
 * variable, never a generic query executor. This is what makes "cannot
 * access an unauthorized table" a structural, testable property.
 */
const TABLE = `"${config.appStore.schema}".flipkart_reviews`;

const COLUMNS = `
  id, pid, review_id, brand_name, rating, title, comment, review_date,
  product_url, author_name, verified_purchase, helpful_count, country,
  "updatedAt"
`;

/** Track A: new-row keyset scan, ordered by the indexed primary key. */
export async function getFlipkartReviewsPage(
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  const rows = await appSequelize.query<RawFlipkartReview>(
    `SELECT ${COLUMNS} FROM ${TABLE} WHERE id > :afterId ORDER BY id LIMIT :limit`,
    {
      replacements: { afterId, limit },
      type: QueryTypes.SELECT,
    },
  );
  return rows;
}

/** Track B: bounded reconciliation window, ordered by id for stable chunking. */
export async function getFlipkartReviewsByDateWindow(
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  const rows = await appSequelize.query<RawFlipkartReview>(
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
