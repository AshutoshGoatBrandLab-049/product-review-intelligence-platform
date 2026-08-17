import { prodPool } from "../database/prodReadOnly/client.js";
import { getFlipkartReviewsPage, getMyntraReviewsPage } from "../database/prodReadOnly/index.js";
import { config } from "../config/index.js";
import { logger } from "../shared/logger.js";
import { isMainModule } from "../shared/isMainModule.js";

export interface CanaryResult {
  ok: boolean;
  checks: Record<string, boolean>;
  errors: string[];
}

/**
 * Security layer 5 — READ ONLY, corrected design.
 *
 * The original design for this canary attempted a harmless write against
 * production to prove the read-only role would reject it. That was a real
 * flaw: in exactly the failure mode this exists to catch — the role
 * accidentally over-provisioned with write access — the canary's own write
 * attempt IS the accident. Catching it after doesn't undo it.
 *
 * This version only ever reads. It cannot prove the role rejects writes —
 * only that reads succeed and identity/connectivity are as expected. That's
 * the correct trade: proving write-rejection would require attempting a
 * write, which the absolute safety rule forbids regardless of expected
 * outcome. Write-rejection is verified elsewhere — a local role mirroring
 * review_intel_ro's grants (tests/security), and the DBA's own review of the
 * role's actual grants at provisioning time.
 */
export async function runCanary(): Promise<CanaryResult> {
  const checks: Record<string, boolean> = {};
  const errors: string[] = [];

  try {
    const identity = await prodPool.query<{ user: string; db: string }>(
      'SELECT current_user AS "user", current_database() AS db',
    );
    checks.identityQuerySucceeded = true;
    checks.expectedUser = identity.rows[0]?.user === config.prodReadOnly.user;
    checks.expectedDatabase = identity.rows[0]?.db === config.prodReadOnly.database;
  } catch (err) {
    checks.identityQuerySucceeded = false;
    errors.push(`identity check failed: ${(err as Error).message}`);
  }

  try {
    await prodPool.query("SELECT 1");
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
