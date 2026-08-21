/**
 * Automatic source-table change detection.
 *
 * Closes the last gap in `source → UI`: the pipeline was correct but nothing ever
 * started it, so a direct `INSERT` / `UPDATE` / `DELETE` against a marketplace
 * source table sat there until a human ran ingestion.
 *
 * ── Why PostgreSQL statistics counters ───────────────────────────────────────
 *
 * `pg_stat_all_tables` maintains cumulative n_tup_ins / n_tup_upd / n_tup_del per
 * table. Reading them costs ~0.7ms, touches no table data, and is O(1) in table
 * size. Crucially it catches a BARE update:
 *
 *     UPDATE myntra_reviews SET rating = 1 WHERE review_id = '…';
 *
 * `updatedAt` on these tables has no index and NO trigger, so that statement does
 * not move it — a metadata probe (COUNT / MAX(id) / MAX(updatedAt)) misses the
 * change entirely, costs ~8ms, and scans the table. Counters see it.
 *
 * Alternatives were rejected on constraints, not taste:
 *   - trigger + NOTIFY  → DDL on source tables this project does not own
 *   - logical replication → wal_level is `replica`; switching needs a PG restart,
 *                           and an unconsumed slot can pin WAL and fill the disk
 *
 * ── Counters are a HINT, never the truth ─────────────────────────────────────
 *
 * They are approximate, can lag, and reset on `pg_stat_reset()`, crash recovery or
 * a server restart. This detector therefore never treats them as authoritative:
 *
 *   - counters MOVED            → reconcile
 *   - counters went BACKWARDS   → they reset; state is unknown → reconcile
 *   - nothing observed yet      → first tick after boot → reconcile
 *   - sweep interval elapsed    → reconcile regardless of what counters say
 *
 * The database stays the source of truth; correctness comes from the existing
 * reconciliation (Track A + Track B), which this only *starts*. That is deliberate:
 * a second synchronization path would put proven guarantees at risk for no gain.
 */

import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { logger } from "../../shared/logger.js";
import { runIngestion } from "./runIngestion.js";
import { LockHeldError } from "./watermarkRepo.js";
import { SOURCE_TABLES } from "./sourceReplacement.js";
import type { Platform } from "../../types/unifiedReview.js";

const PLATFORMS: Platform[] = ["flipkart", "myntra"];

interface Counters {
  ins: number;
  upd: number;
  del: number;
}

export interface DetectorTick {
  platform: Platform;
  reason: "counters_changed" | "counters_reset" | "first_run" | "periodic_sweep" | "retry_after_failure";
  counters: Counters;
}

/** Read the cumulative tuple counters for both source tables in one round-trip. */
export async function readSourceCounters(): Promise<Record<Platform, Counters>> {
  const schema = config.appStore.schema;
  const tableToPlatform = new Map<string, Platform>(
    PLATFORMS.map((p) => [SOURCE_TABLES[p].table, p]),
  );

  const rows = await appSequelize.query<{
    relname: string;
    ins: string;
    upd: string;
    del: string;
  }>(
    `SELECT relname,
            COALESCE(n_tup_ins,0)::text AS ins,
            COALESCE(n_tup_upd,0)::text AS upd,
            COALESCE(n_tup_del,0)::text AS del
       FROM pg_stat_all_tables
      WHERE schemaname = $1 AND relname = ANY($2)`,
    { type: QueryTypes.SELECT, bind: [schema, [...tableToPlatform.keys()]] },
  );

  const out = {} as Record<Platform, Counters>;
  for (const p of PLATFORMS) out[p] = { ins: 0, upd: 0, del: 0 };
  for (const r of rows || []) {
    const platform = tableToPlatform.get(r.relname);
    if (platform) {
      out[platform] = { ins: Number(r.ins), upd: Number(r.upd), del: Number(r.del) };
    }
  }
  return out;
}

function movedForward(prev: Counters, next: Counters): boolean {
  return next.ins > prev.ins || next.upd > prev.upd || next.del > prev.del;
}

/** Any counter going backwards means the stats were reset — treat state as unknown. */
function wentBackwards(prev: Counters, next: Counters): boolean {
  return next.ins < prev.ins || next.upd < prev.upd || next.del < prev.del;
}

export class SourceChangeDetector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Guards against overlapping ticks when an ingestion outlasts the poll interval. */
  private tickInFlight = false;

  private lastSeen = new Map<Platform, Counters>();
  private lastSyncAt = new Map<Platform, number>();
  /** Set when a reconcile failed, so the next tick retries even if counters are quiet. */
  private dirty = new Set<Platform>();

  /** Observability for tests and for operators. */
  readonly stats = {
    ticks: 0,
    reconciles: 0,
    failures: 0,
    skippedLockHeld: 0,
    lastReasons: [] as DetectorTick[],
  };

  start(): void {
    if (this.running) return;
    if (!config.autoSync.enabled) {
      logger.warn(
        {},
        "Source change detector DISABLED (AUTO_SYNC_ENABLED=false) — source changes will NOT reach the UI automatically",
      );
      return;
    }

    this.running = true;
    logger.info(
      {
        pollMs: config.autoSync.pollMs,
        sweepMs: config.autoSync.sweepMs,
        platforms: PLATFORMS,
      },
      "Source change detector started",
    );

    // unref() so a lingering timer can never hold the process open.
    this.timer = setInterval(() => {
      void this.tick();
    }, config.autoSync.pollMs);
    this.timer.unref?.();

    // Reconcile immediately on boot rather than waiting a full interval — this is
    // what makes a backend restart recover changes made while it was down.
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info({}, "Source change detector stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * One poll cycle. Never throws — a detector that dies on a transient database
   * error would silently stop synchronizing, which is the failure mode this whole
   * component exists to prevent.
   */
  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    this.stats.ticks += 1;

    try {
      const counters = await readSourceCounters();

      for (const platform of PLATFORMS) {
        const next = counters[platform];
        const prev = this.lastSeen.get(platform);
        const now = Date.now();
        const lastSync = this.lastSyncAt.get(platform) ?? 0;

        let reason: DetectorTick["reason"] | null = null;
        if (this.dirty.has(platform)) reason = "retry_after_failure";
        else if (!prev) reason = "first_run";
        else if (wentBackwards(prev, next)) reason = "counters_reset";
        else if (movedForward(prev, next)) reason = "counters_changed";
        else if (now - lastSync >= config.autoSync.sweepMs) reason = "periodic_sweep";

        if (!reason) {
          // Cheap path: nothing to do. Record the counters so a later comparison
          // is against the most recent observation.
          this.lastSeen.set(platform, next);
          continue;
        }

        await this.reconcile(platform, next, reason);
      }
    } catch (err) {
      this.stats.failures += 1;
      logger.error(
        { error: (err as Error).message },
        "Source change detector tick failed — will retry on the next interval",
      );
    } finally {
      this.tickInFlight = false;
    }
  }

  private async reconcile(platform: Platform, counters: Counters, reason: DetectorTick["reason"]): Promise<void> {
    const tick: DetectorTick = { platform, reason, counters };
    this.stats.lastReasons.push(tick);
    if (this.stats.lastReasons.length > 20) this.stats.lastReasons.shift();

    const startedAt = Date.now();
    logger.info(
      { platform, reason, counters, detectedAt: new Date(startedAt).toISOString() },
      "Source change DETECTED — starting automatic ingestion",
    );

    try {
      await runIngestion(platform);

      // Only now is it safe to remember these counters. Persisting them before a
      // successful reconcile would make a failed run look like a clean one and the
      // change would be lost until the next sweep.
      this.lastSeen.set(platform, counters);
      this.lastSyncAt.set(platform, Date.now());
      this.dirty.delete(platform);
      this.stats.reconciles += 1;

      logger.info(
        { platform, reason, durationMs: Date.now() - startedAt },
        "Automatic ingestion complete",
      );
    } catch (err) {
      if (err instanceof LockHeldError) {
        // Another instance (or an admin-triggered run) already holds the platform
        // lock. Leave the platform dirty so this is retried, and do not count it
        // as a failure — the work is being done, just not by us.
        this.dirty.add(platform);
        this.stats.skippedLockHeld += 1;
        logger.debug({ platform }, "Automatic ingestion skipped — lock held elsewhere; will retry");
        return;
      }

      this.dirty.add(platform);
      this.stats.failures += 1;
      logger.error(
        { platform, reason, error: (err as Error).message },
        "Automatic ingestion FAILED — change not lost, will retry on the next interval",
      );
    }
  }
}

export const sourceChangeDetector = new SourceChangeDetector();
