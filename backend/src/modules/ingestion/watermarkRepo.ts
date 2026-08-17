import { Transaction } from "sequelize";
import { IngestionWatermark } from "../../database/appStore/models/ingestionWatermark.js";
import type { Platform } from "../../types/unifiedReview.js";
import { acquireIngestionLock, LockHeldError, LockAcquisitionError, type IngestionLock } from "./advisoryLock.js";

export { LockHeldError, LockAcquisitionError };

async function getOrCreateWatermark(platform: Platform): Promise<IngestionWatermark> {
  const [watermark] = await IngestionWatermark.findOrCreate({
    where: { platform },
    defaults: { platform, lastSeenSourceId: 0, status: "idle" },
  });
  return watermark;
}

// Per-process record of which platforms this process currently holds the
// advisory lock for, so releaseLock(platform) can find the specific
// connection that acquired it (session-scoped locks release on that same
// connection — see advisoryLock.ts).
const heldLocks = new Map<Platform, IngestionLock>();

/**
 * Acquires the per-platform job lock via a PostgreSQL session-scoped advisory
 * lock (Phase 2.1 §1B — replaces the prior SERIALIZABLE + FOR UPDATE design,
 * which Phase 2 §18 proved does not reliably serialize concurrent callers).
 * Both Track A and Track B run under the same lock — they're both
 * once-daily, so there's no benefit to decoupling their schedules (Phase 1
 * plan §4). Throws LockHeldError on normal contention, LockAcquisitionError
 * on anything else going wrong — never a raw, unclassified driver error.
 */
export async function acquireLock(platform: Platform): Promise<void> {
  if (heldLocks.has(platform)) {
    // Defensive: this process already holds it. Should not happen in normal
    // use (runIngestion.ts acquires once per invocation), but must never
    // silently double-acquire.
    throw new LockHeldError(platform);
  }

  const lock = await acquireIngestionLock(platform);
  heldLocks.set(platform, lock);

  // Best-effort observability only from here on — the advisory lock above is
  // the sole source of correctness. A failure updating this row must not
  // leave the real lock held without a way to release it, so errors here are
  // deliberately not thrown past this point once the real lock is secured.
  try {
    const watermark = await getOrCreateWatermark(platform);
    watermark.status = "running";
    watermark.lockAcquiredAt = new Date();
    await watermark.save();
  } catch {
    // Visibility-only state; the real lock is unaffected.
  }
}

export async function releaseLock(platform: Platform): Promise<void> {
  const lock = heldLocks.get(platform);
  if (lock) {
    heldLocks.delete(platform);
    await lock.release();
  }

  await IngestionWatermark.update(
    { status: "idle", lockAcquiredAt: null },
    { where: { platform } },
  ).catch(() => undefined);
}

export async function getLastSeenSourceId(platform: Platform): Promise<number> {
  const watermark = await getOrCreateWatermark(platform);
  return Number(watermark.lastSeenSourceId);
}

/**
 * Advances the new-row cursor. Callers are responsible for calling this
 * inside the SAME transaction as the batch's own insert — that atomicity is
 * what guarantees "watermark advances if and only if the write commits"
 * (Phase 1 plan §I, case 1 and 3).
 */
export async function advanceLastSeenSourceId(
  platform: Platform,
  newLastSeenId: number,
  transaction: Transaction,
): Promise<void> {
  await IngestionWatermark.update(
    { lastSeenSourceId: newLastSeenId },
    { where: { platform }, transaction },
  );
}

export async function recordReconciliationRun(
  platform: Platform,
  rowsScanned: number,
  rowsChanged: number,
): Promise<void> {
  await IngestionWatermark.update(
    {
      lastReconciliationRunAt: new Date(),
      lastReconciliationRowsScanned: rowsScanned,
      lastReconciliationRowsChanged: rowsChanged,
    },
    { where: { platform } },
  );
}
