/**
 * Snapshot/restore for test files that need total control of the shared tables.
 *
 * Several suites (e.g. tests/unit/reviewRetrieval.test.ts) read the shared
 * fixture dataset instead of seeding their own rows, so any file that truncates
 * source or canonical tables silently breaks whichever file runs next. Rather
 * than rely on execution order, a file that needs a clean slate takes a snapshot
 * up front and puts it back afterwards, leaving the database exactly as found.
 */

import { QueryTypes } from "sequelize";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";

const S = config.appStore.schema;

export const SNAPSHOT_TABLES = [
  "myntra_reviews",
  "flipkart_reviews",
  "normalized_reviews",
  "product_dimension",
  "product_daily_metrics",
  "ingestion_watermarks",
] as const;

/** Refuse to touch anything but the isolated test database. */
export async function assertTestDatabase(): Promise<void> {
  const rows = (await appSequelize.query("SELECT current_database() AS db", {
    type: QueryTypes.SELECT,
  })) as Array<{ db: string }>;
  const db = rows[0]?.db;
  if (db !== "pri_test_appstore") {
    throw new Error(`REFUSING TO RUN: expected pri_test_appstore, got '${db}'`);
  }
}

export async function snapshotTables(): Promise<void> {
  await assertTestDatabase();
  for (const t of SNAPSHOT_TABLES) {
    await appSequelize.query(`DROP TABLE IF EXISTS "${S}".__snap_${t}`);
    await appSequelize.query(`CREATE TABLE "${S}".__snap_${t} AS TABLE "${S}".${t}`);
  }
}

export async function restoreTables(): Promise<void> {
  await truncateAll();
  for (const t of SNAPSHOT_TABLES) {
    await appSequelize.query(`INSERT INTO "${S}".${t} SELECT * FROM "${S}".__snap_${t}`);
    await appSequelize.query(`DROP TABLE IF EXISTS "${S}".__snap_${t}`);
  }
  await resyncSequences();
}

export async function truncateAll(): Promise<void> {
  await appSequelize.query(
    `TRUNCATE "${S}".review_sentiment, "${S}".review_theme, "${S}".identity_anomalies,
              "${S}".normalized_reviews, "${S}".product_dimension,
              "${S}".product_daily_metrics, "${S}".ingestion_watermarks,
              "${S}".myntra_reviews, "${S}".flipkart_reviews CASCADE`,
  );
}

export async function resyncSequences(): Promise<void> {
  for (const t of ["myntra_reviews", "flipkart_reviews"]) {
    await appSequelize.query(
      `SELECT setval('"${S}".${t}_id_seq', GREATEST((SELECT COALESCE(MAX(id),1) FROM "${S}".${t}), 1))`,
    );
  }
}
