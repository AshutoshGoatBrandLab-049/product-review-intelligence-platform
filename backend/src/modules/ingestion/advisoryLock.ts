import { Client } from "pg";
import { config } from "../../config/index.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Session-scoped PostgreSQL advisory lock — the mutual-exclusion primitive
 * for ingestion (Phase 2.1 §1B).
 *
 * Chosen over row-level SELECT ... FOR UPDATE under SERIALIZABLE (the prior
 * design, proven unreliable in Phase 2 §18):
 *
 *  - Correctness: pg_try_advisory_lock is a simple, non-MVCC mutex keyed by a
 *    fixed integer — it does not depend on any row existing, so there is no
 *    "does the lock target exist yet" race (Phase 2.1 §1C is structurally
 *    eliminated, not just carefully sequenced).
 *  - Crash behavior: session-scoped advisory locks are released automatically
 *    when the holding connection closes — including on process crash — so
 *    there is no stale-lock heuristic to get wrong. The prior STALE_LOCK_MS
 *    reclaim logic is removed entirely, not reimplemented.
 *  - Serialization failures: advisory locks are never involved in
 *    serializable-snapshot conflict detection, so 40001 cannot originate from
 *    lock acquisition itself under this design (Phase 2.1 §1D).
 *  - Session vs transaction scope: deliberately session-scoped
 *    (pg_try_advisory_lock), not transaction-scoped
 *    (pg_try_advisory_xact_lock) — the lock must stay held across Track A's
 *    many independently-committed per-batch transactions and Track B's run,
 *    not just one transaction. This requires holding a single dedicated
 *    connection for the lock's lifetime (via a raw pg.Client, outside
 *    Sequelize's pool) and explicitly releasing it when done.
 *  - Multi-process / deployment behavior: works identically whether the two
 *    workers are two processes, two containers, or two threads — the lock
 *    lives in Postgres, not in this process's memory.
 */

// Fixed, namespaced constants — must never change once used against a real
// deployment (a changed key would let old and new code fail to see each
// other's locks). Two platforms only; explicit constants are safer here than
// hashing the platform name, since collision is not even a possibility.
const LOCK_KEYS: Record<Platform, number> = {
  flipkart: 7_301_001,
  myntra: 7_301_002,
};

export class LockHeldError extends Error {
  constructor(platform: Platform) {
    super(`Ingestion lock for "${platform}" is already held by another worker.`);
    this.name = "LockHeldError";
  }
}

/**
 * Anything that goes wrong while trying to acquire/release the lock itself
 * (connection failure, unexpected driver error) — deliberately distinct from
 * LockHeldError (normal contention) so callers can tell "another worker has
 * this" apart from "something is actually broken" (Phase 2.1 §1D).
 */
export class LockAcquisitionError extends Error {
  readonly code = "LOCK_ACQUISITION_FAILED";
  constructor(platform: Platform, cause: string) {
    super(`Failed to acquire ingestion lock for "${platform}": ${cause}`);
    this.name = "LockAcquisitionError";
  }
}

export interface IngestionLock {
  readonly platform: Platform;
  release(): Promise<void>;
}

function appStoreClientConfig() {
  return {
    host: config.appStore.host,
    port: config.appStore.port,
    database: config.appStore.database,
    user: config.appStore.user,
    password: config.appStore.password,
  };
}

/**
 * Attempts to acquire the advisory lock for `platform` on a dedicated
 * connection. Non-blocking: returns immediately, throwing LockHeldError if
 * another session already holds it. Throws LockAcquisitionError for any
 * other failure — never lets a raw driver error escape unclassified.
 */
export async function acquireIngestionLock(platform: Platform): Promise<IngestionLock> {
  const client = new Client(appStoreClientConfig());

  try {
    await client.connect();
  } catch (err) {
    throw new LockAcquisitionError(platform, `could not connect: ${(err as Error).message}`);
  }

  let acquired: boolean;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [LOCK_KEYS[platform]],
    );
    acquired = rows[0]!.locked;
  } catch (err) {
    await client.end().catch(() => undefined);
    throw new LockAcquisitionError(platform, `advisory lock query failed: ${(err as Error).message}`);
  }

  if (!acquired) {
    await client.end().catch(() => undefined);
    throw new LockHeldError(platform);
  }

  let released = false;
  return {
    platform,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEYS[platform]]);
      } catch {
        // The connection closing below releases the lock regardless — a
        // failed explicit unlock is not itself a correctness problem.
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}
