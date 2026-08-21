/**
 * Points every test at ONE fully isolated local database — NEVER the real
 * gbl_data_lake, and NEVER real production.
 *
 *   pri_test_appstore.product_review_intelligence
 *     ├── flipkart_reviews       ← SOURCE (only two source tables that exist)
 *     ├── myntra_reviews         ← SOURCE
 *     ├── normalized_reviews     ← canonical
 *     ├── product_dimension      ← derived
 *     ├── product_daily_metrics  ← derived
 *     └── ingestion_watermarks   ← derived
 *
 * SINGLE DATABASE, SINGLE SCHEMA — deliberately mirroring production, where
 * gbl_data_lake."DataWarehouse" co-locates source and canonical tables and the
 * application reaches all of them through one connection (config.appStore /
 * appSequelize). An earlier two-database split (pri_test_prodsource, read via
 * DB_PROD_*) predates that unification and no longer matches the code: since
 * the repos switched to appSequelize, nothing connects using DB_PROD_* at all,
 * so source tables parked in a second database were unreachable and every
 * ingestion test failed with `relation ... does not exist`.
 *
 * Source-table DDL, indexes, constraints, defaults and data types were verified
 * column-by-column against live gbl_data_lake."DataWarehouse" (2026-08-20) and
 * are created from src/database/fixtures/sourceTablesFixture.sql. Row data is a
 * COPY of the real marketplace data; the live database is only ever read.
 *
 * Automated tests do not, and must not, depend on real production access.
 */
process.env.DB_DIALECT = "postgres";
process.env.DB_HOST = "localhost";
process.env.DB_PORT = "5432";
process.env.DB_NAME = "pri_test_appstore";
process.env.DB_USER = "postgres";
process.env.DB_PASSWORD = "1234";
process.env.DB_SCHEMA = "product_review_intelligence";

// DB_PROD_* is legacy: config/index.ts still validates these vars, but
// config.prodReadOnly is built from DB_* (see config/index.ts) and prodPool is
// never imported anywhere, so nothing connects with them. They are set here
// only to satisfy schema validation — pointing them at the same single test
// database makes it explicit that no second connection exists.
process.env.DB_PROD_HOST = "localhost";
process.env.DB_PROD_PORT = "5432";
process.env.DB_PROD_NAME = "pri_test_appstore";
process.env.DB_PROD_SCHEMA = "DataWarehouse";
process.env.DB_PROD_USER = "postgres";
process.env.DB_PROD_PASSWORD = "1234";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.INGEST_BATCH_SIZE = "5000";
process.env.RECONCILE_LOOKBACK_DAYS = "60";
process.env.RECONCILE_SAFETY_BUFFER_DAYS = "10";

// Phase 4 — the test suite must never depend on a real AI provider.
process.env.AI_PROVIDER = "mock";
process.env.AI_BATCH_SIZE = "5";
process.env.AI_MAX_RETRIES = "2";
process.env.AI_RETRY_MIN_TIMEOUT_MS = "5"; // real exponential backoff would make tests slow for no benefit

// Phase 6 — API tests need a real (test-only) JWT secret to sign/verify
// tokens; never used outside the test process.
process.env.JWT_SECRET = "test-only-jwt-secret-never-used-outside-tests";
process.env.JWT_EXPIRES_IN = "1h";
// Deliberately generous: the shared apiRateLimiter middleware instance is a
// module-level singleton (one rate-limit store for the whole test process,
// across every test file that imports createApp()), so a tight limit here
// would make unrelated functional tests fail from cumulative request count,
// not from anything they're actually testing. The dedicated rate-limit test
// (apiRateLimit.test.ts) builds its own isolated, tightly-configured
// express-rate-limit instance instead of relying on these values, so real
// 429 behavior is still proven deterministically without this tradeoff.
process.env.RATE_LIMIT_WINDOW_MS = "60000";
process.env.RATE_LIMIT_MAX = "10000";
