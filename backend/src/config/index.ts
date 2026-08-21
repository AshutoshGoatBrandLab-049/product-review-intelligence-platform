import "dotenv/config";
import { z } from "zod";

/**
 * Env schema, validated once at process start. Mirrors the convention used by
 * both sibling crawler repos (Zod-validated config/index.js), extended with
 * the two-connection split this platform requires.
 */
const envSchema = z.object({
  // Local application store — writable, dev/test only.
  DB_DIALECT: z.literal("postgres").default("postgres"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(""),
  DB_SCHEMA: z.string().min(1),

  // Production source — READ ONLY. review_intel_ro role, SELECT-only.
  DB_PROD_HOST: z.string().min(1),
  DB_PROD_PORT: z.coerce.number().int().positive().default(5432),
  DB_PROD_NAME: z.string().min(1),
  DB_PROD_SCHEMA: z.literal("DataWarehouse").default("DataWarehouse"),
  DB_PROD_USER: z.string().min(1),
  DB_PROD_PASSWORD: z.string().default(""),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  INGEST_BATCH_SIZE: z.coerce.number().int().positive().default(5000),
  RECONCILE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(60),
  RECONCILE_SAFETY_BUFFER_DAYS: z.coerce.number().int().nonnegative().default(10),
  /**
   * Track B scan strategy.
   *
   * "true"  — reconcile the ENTIRE source by id cursor (default).
   * "false" — reconcile only reviews inside the RECONCILE_LOOKBACK_DAYS window.
   *
   * Defaults to a full scan because the windowed scan is silently lossy: Track A
   * never revisits a row once its id is below the watermark, so an edit to a
   * review older than the window reaches neither track and the canonical copy
   * stays wrong indefinitely (verified — a 200-day-old review edited from rating
   * 5 to 1 kept reporting 5). The window was only affordable-by-necessity when
   * Track B issued one query per row; with batched lookups a full scan costs a
   * handful of queries per run, so correctness no longer has to be traded away.
   *
   * Set to "false" only for a source large enough that the full scan becomes the
   * bottleneck, accepting that older edits will be missed.
   */
  RECONCILE_FULL_SCAN: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Phase 4 — AI provider. Defaults to "mock": this project must never
  // silently start making paid API calls just because it booted.
  AI_PROVIDER: z.enum(["mock", "anthropic", "gemini", "openai"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  AI_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  AI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  AI_RETRY_MIN_TIMEOUT_MS: z.coerce.number().int().positive().default(1000),
  // Phase 4.1 remediation item 2 — caps how long a single retry will ever
  // wait even when a provider suggests a longer delay (e.g. Gemini's
  // RetryInfo.retryDelay), so a pathological/misconfigured suggested delay
  // can't stall the batch. 30s comfortably covers every real retryDelay
  // observed in Phase 4.1 (11s, 24.78s) with headroom.
  AI_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(30000),

  // Phase 5 Step 4 — early-warning thresholds, tuned against the real,
  // restored local dataset (1,004 products, scripts/phase5EarlyWarningTuningStep4.ts,
  // documented in docs/implementation/phase-5-early-warning-marketplace-report.md
  // once written). Every default below is evidence-derived from the OBSERVED
  // real distribution, not guessed — each comment states exactly what was
  // measured and why.
  //
  // ratingDeclinePercent: UNCHANGED from its original hardcoded value. At -15%
  // it fired on 62/1004 products (6.2%) — already selective, no evidence of
  // being too noisy or too dead, so left as-is per Step 4's own rule: adjust
  // ONLY when the data shows a clear problem.
  WARNING_RATING_DECLINE_PCT: z.coerce.number().default(-15),
  // negativeReviewIncreasePercent: RAISED from 20 to 100. At 20%, the real
  // negative-review growth-rate distribution (n=960 products with a
  // computable rate) showed the threshold sitting only around the ~64th
  // percentile — it fired on 36.25% of all products, too common to function
  // as a meaningful signal. The real distribution's p90 is ~104.6%; 100% (a
  // clean "negative rate doubled" threshold) sits almost exactly there and
  // fires on 10.8% of products with a computable rate — genuinely selective.
  WARNING_NEGATIVE_INCREASE_PCT: z.coerce.number().default(100),
  // volumeSpikeMultiplier: RAISED from 2 to 3. At 2x, the real review-volume
  // ratio distribution (n=1000) showed the threshold sitting almost exactly
  // at the MEDIAN (1.92x) — it fired on 45.8% of all products, meaning it was
  // capturing this dataset's broad background volume growth, not anomalies.
  // The real distribution's p90/p95 are 2.75x/3.11x; 3x sits between them and
  // fires on only 6.4% of products — a real, selective "spike."
  WARNING_VOLUME_SPIKE_MULTIPLIER: z.coerce.number().default(3),
  // complaintSpikePercent: its first-ever default, derived from the real
  // complaint-mention growth-rate distribution (197 of 1,004 products had a
  // computable rate — i.e. non-zero complaint mentions in both windows; 652
  // had none in either window, 155 had a zero baseline and are excluded from
  // a growth-RATE calculation the same way sudden_negative_review_increase
  // already excludes zero-baseline cases). That distribution's p90 is 200%;
  // 200% fires on 14.2% of the 197 computable-rate products, ≈2.8% of the
  // full 1,004-product catalog — an appropriately rare, meaningful rate for
  // an early-warning signal, not a guess.
  WARNING_COMPLAINT_SPIKE_PCT: z.coerce.number().default(200),

  // Phase 6 Step 2 — API auth/rate-limiting. JWT_SECRET deliberately has NO
  // real default (empty string) — an empty secret is trivially insecure, so
  // the server refuses to boot on an empty secret (assertJwtSecretConfigured,
  // called from server.ts only, never from tests) rather than silently
  // signing/verifying tokens with nothing. Tests set a real value explicitly
  // (tests/setupTestEnv.ts) — this is the same pattern AI_PROVIDER already
  // uses (default that's safe for accidental omission, explicit override
  // where real behavior is needed).
  JWT_SECRET: z.string().default(""),
  JWT_EXPIRES_IN: z.string().default("12h"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

/**
 * DB_PROD_HOST/DB_PROD_USER are only truly required once production access is
 * actually being used (Track A/B execution, canary). Ingestion-unrelated work
 * (schema/table setup, unit tests) doesn't need them, so they default to an
 * empty-but-typed placeholder rather than failing config parsing outright —
 * callers that need a live prod connection get a clear runtime error instead.
 */
function parseEnv(source: NodeJS.ProcessEnv) {
  const withDefaults = {
    ...source,
    DB_PROD_HOST: source.DB_PROD_HOST || "unset.invalid",
    DB_PROD_NAME: source.DB_PROD_NAME || "unset",
    DB_PROD_USER: source.DB_PROD_USER || "unset",
  };
  const parsed = envSchema.safeParse(withDefaults);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}

const env = parseEnv(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,

  appStore: {
    dialect: env.DB_DIALECT,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    schema: env.DB_SCHEMA,
  },

  prodReadOnly: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    schema: env.DB_SCHEMA,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    /** The only two tables this application is ever permitted to read. */
    allowedTables: ["flipkart_reviews", "myntra_reviews"] as const,
  },

  ingestion: {
    batchSize: env.INGEST_BATCH_SIZE,
    reconcileLookbackDays: env.RECONCILE_LOOKBACK_DAYS,
    reconcileSafetyBufferDays: env.RECONCILE_SAFETY_BUFFER_DAYS,
    reconcileFullScan: env.RECONCILE_FULL_SCAN,
  },

  ai: {
    provider: env.AI_PROVIDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    batchSize: env.AI_BATCH_SIZE,
    maxRetries: env.AI_MAX_RETRIES,
    retryMinTimeoutMs: env.AI_RETRY_MIN_TIMEOUT_MS,
    retryMaxDelayMs: env.AI_RETRY_MAX_DELAY_MS,
  },

  earlyWarning: {
    ratingDeclinePercent: env.WARNING_RATING_DECLINE_PCT,
    negativeReviewIncreasePercent: env.WARNING_NEGATIVE_INCREASE_PCT,
    volumeSpikeMultiplier: env.WARNING_VOLUME_SPIKE_MULTIPLIER,
    /** undefined until Step 4 derives a real default from observed data — see schema comment above. */
    complaintSpikePercent: env.WARNING_COMPLAINT_SPIKE_PCT,
  },

  api: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
  },
} as const;

export type AppConfig = typeof config;

/**
 * Security layer 4: unified connection validation. The application now uses
 * a single database connection for all operations. In production, this guard
 * ensures the configuration points to the correct database and environment.
 * Tests may use different database names for isolation.
 */
export function assertDatabaseConfiguration(cfg: AppConfig = config): void {
  // Only enforce strict configuration in production
  if (cfg.nodeEnv === "production") {
    const errors: string[] = [];

    if (cfg.appStore.schema !== "DataWarehouse") {
      errors.push(`Schema must be 'DataWarehouse', got '${cfg.appStore.schema}'`);
    }

    if (cfg.appStore.database !== "gbl_data_lake") {
      errors.push(`Database must be 'gbl_data_lake', got '${cfg.appStore.database}'`);
    }

    const host = cfg.appStore.host;
    const isLocalhost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local") ||
      host === "0.0.0.0";
    if (!isLocalhost) {
      errors.push(`Host must be localhost, got '${host}' (prevents remote connections)`);
    }

    if (cfg.appStore.user !== "postgres") {
      errors.push(`User must be 'postgres', got '${cfg.appStore.user}' (requires unified connection)`);
    }

    if (errors.length > 0) {
      throw new Error(`Database configuration is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
  }
}

assertDatabaseConfiguration(config);

/**
 * Phase 6 Step 2 — deliberately NOT called at module load (unlike
 * assertConnectionsAreDistinct above): every script/test that imports config
 * would otherwise be forced to set JWT_SECRET even when it never touches the
 * API layer. Called once, explicitly, from server.ts's boot sequence only —
 * the API process refuses to start with an empty secret, but importing
 * config for analytics/ingestion/AI work is unaffected.
 */
export function assertJwtSecretConfigured(cfg: AppConfig = config): void {
  if (cfg.api.jwtSecret.length === 0) {
    throw new Error(
      "Refusing to start the API server: JWT_SECRET is empty. Set a real secret " +
        "before starting the API — an empty secret would make every token " +
        "trivially forgeable.",
    );
  }
}
