/**
 * Rebuild the vitest canonical fixture in pri_test_appstore by running the REAL
 * ingestion pipeline over whatever source rows are present there.
 *
 * Much of the suite (e.g. tests/unit/reviewRetrieval.test.ts) reads pre-existing
 * normalized_reviews / product_dimension rows instead of seeding its own, so the
 * test database needs a populated, reproducible baseline. Producing it by actually
 * running Track A — rather than hand-inserting rows — means the fixture is exactly
 * what the pipeline produces.
 *
 * IMPORTANT — keep the SOURCE fixture small (the shipped fixture is 3 flipkart +
 * 3 myntra rows, pids PID001/PID002). Several suites assert exact ingestion counts
 * and run under a 20s timeout, so loading a large dataset into the shared source
 * tables makes trackA / trackB / e2e / observability / concurrency time out.
 * Verification against the full real marketplace dataset is a SEPARATE, explicit
 * exercise — not the default fixture.
 *
 * Safe by construction: refuses to run against any database but pri_test_appstore.
 *
 * Usage:  npx tsx scripts/seedTestFixtures.ts
 */

// Must be set BEFORE config is imported.
process.env.DB_DIALECT = "postgres";
process.env.DB_HOST = "localhost";
process.env.DB_PORT = "5432";
process.env.DB_NAME = "pri_test_appstore";
process.env.DB_USER = "postgres";
process.env.DB_PASSWORD = "1234";
process.env.DB_SCHEMA = "product_review_intelligence";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.AI_PROVIDER = "mock";
process.env.JWT_SECRET = "test-only-jwt-secret-never-used-outside-tests";

const { appSequelize } = await import("../src/database/appStore/client.js");
const { config } = await import("../src/config/index.js");
const { runTrackA } = await import("../src/modules/ingestion/trackA.js");
const { QueryTypes } = await import("sequelize");

const S = config.appStore.schema;

async function main() {
  const dbRows = (await appSequelize.query("SELECT current_database() AS db", {
    type: QueryTypes.SELECT,
  })) as Array<{ db: string }>;
  const db = dbRows[0]?.db;

  if (db !== "pri_test_appstore") {
    throw new Error(`REFUSING TO RUN: expected pri_test_appstore, got '${db}'`);
  }
  console.log(`Target database: ${db}.${S}\n`);

  console.log("Clearing canonical/derived tables...");
  await appSequelize.query(
    `TRUNCATE "${S}".review_sentiment, "${S}".review_theme, "${S}".identity_anomalies,
              "${S}".normalized_reviews, "${S}".product_dimension,
              "${S}".product_daily_metrics, "${S}".ingestion_watermarks CASCADE`,
  );

  for (const platform of ["flipkart", "myntra"] as const) {
    const started = Date.now();
    const result = await runTrackA(platform);
    console.log(
      `${platform.padEnd(9)} rowsRead=${result.rowsRead} inserted=${result.rowsInserted} ` +
        `rejected=${result.rowsRejected} watermark=${result.finalLastSeenSourceId} ` +
        `status=${result.status} (${Date.now() - started}ms)`,
    );
  }

  console.log("\n=== Resulting fixture state ===");
  const rows = (await appSequelize.query(
    `SELECT 'normalized_reviews    ' AS t, COUNT(*)::text AS n FROM "${S}".normalized_reviews
     UNION ALL SELECT '  .. flipkart        ', COUNT(*)::text FROM "${S}".normalized_reviews WHERE platform='flipkart'
     UNION ALL SELECT '  .. myntra          ', COUNT(*)::text FROM "${S}".normalized_reviews WHERE platform='myntra'
     UNION ALL SELECT 'product_dimension    ', COUNT(*)::text FROM "${S}".product_dimension
     UNION ALL SELECT 'product_daily_metrics', COUNT(*)::text FROM "${S}".product_daily_metrics
     UNION ALL SELECT 'ingestion_watermarks ', COUNT(*)::text FROM "${S}".ingestion_watermarks`,
    { type: QueryTypes.SELECT },
  )) as Array<{ t: string; n: string }>;
  rows.forEach((r) => console.log(`  ${r.t} ${r.n}`));

  await appSequelize.close();
}

main().catch(async (err) => {
  console.error("FAILED:", err);
  await appSequelize.close();
  process.exit(1);
});
