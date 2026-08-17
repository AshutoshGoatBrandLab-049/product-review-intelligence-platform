/**
 * Points every test at fully isolated local databases — NEVER the real
 * gbl_data_lake (which has a pre-existing "DataWarehouse" schema this
 * project didn't create and doesn't touch) and NEVER real production.
 *
 *   pri_test_appstore   — mirrors the local application store
 *   pri_test_prodsource — a local fixture mirroring flipkart_reviews /
 *                         myntra_reviews' verified shape, read via a local
 *                         role (local_review_intel_ro) that mirrors
 *                         review_intel_ro's SELECT-only grants exactly.
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

process.env.DB_PROD_HOST = "localhost";
process.env.DB_PROD_PORT = "5432";
process.env.DB_PROD_NAME = "pri_test_prodsource";
process.env.DB_PROD_SCHEMA = "DataWarehouse";
process.env.DB_PROD_USER = "local_review_intel_ro";
process.env.DB_PROD_PASSWORD = "local_ro_test";

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
