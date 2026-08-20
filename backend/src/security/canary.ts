import { appSequelize } from "../database/appStore/client.js";
import { getFlipkartReviewsPage, getMyntraReviewsPage } from "../database/prodReadOnly/index.js";
import { config } from "../config/index.js";
import { logger } from "../shared/logger.js";
import { isMainModule } from "../shared/isMainModule.js";
import { QueryTypes } from "sequelize";

export interface CanaryResult {
  ok: boolean;
  checks: Record<string, boolean>;
  errors: string[];
}

/**
 * Security layer 5 — connectivity and data access verification.
 *
 * Verifies that the unified database connection is working correctly and
 * can read from both source tables (flipkart_reviews, myntra_reviews).
 */
export async function runCanary(): Promise<CanaryResult> {
  const checks: Record<string, boolean> = {};
  const errors: string[] = [];

  try {
    const identity = await appSequelize.query<{ user: string; db: string }>(
      'SELECT current_user AS "user", current_database() AS db',
      { type: QueryTypes.SELECT },
    );
    checks.identityQuerySucceeded = true;
    checks.expectedUser = identity[0]?.user === config.appStore.user;
    checks.expectedDatabase = identity[0]?.db === config.appStore.database;
  } catch (err) {
    checks.identityQuerySucceeded = false;
    errors.push(`identity check failed: ${(err as Error).message}`);
  }

  try {
    await appSequelize.query("SELECT 1", { type: QueryTypes.SELECT });
    checks.connectivity = true;
  } catch (err) {
    checks.connectivity = false;
    errors.push(`connectivity check failed: ${(err as Error).message}`);
  }

  try {
    // Tiny page, reuses the same fixed-surface function Track A calls — no
    // new query shape, no new code path; existence + read-access proven at once.
    await getFlipkartReviewsPage(0, 1);
    checks.flipkartReadable = true;
  } catch (err) {
    checks.flipkartReadable = false;
    errors.push(`flipkart_reviews read failed: ${(err as Error).message}`);
  }

  try {
    await getMyntraReviewsPage(0, 1);
    checks.myntraReadable = true;
  } catch (err) {
    checks.myntraReadable = false;
    errors.push(`myntra_reviews read failed: ${(err as Error).message}`);
  }

  const ok = Object.values(checks).every(Boolean) && errors.length === 0;

  logger.info({ ok, checks, errorCount: errors.length }, "Production canary run complete");

  return { ok, checks, errors };
}

if (isMainModule(import.meta.url)) {
  runCanary()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
