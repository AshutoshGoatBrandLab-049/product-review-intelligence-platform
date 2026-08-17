import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "pg";
import {
  acquireLock,
  releaseLock,
  LockHeldError,
} from "../../src/modules/ingestion/watermarkRepo.js";
import { IngestionWatermark } from "../../src/database/appStore/models/ingestionWatermark.js";
import { config } from "../../src/config/index.js";
import { resetAppStore } from "../helpers/resetAppStore.js";

const FLIPKART_LOCK_KEY = 7_301_001; // must match advisoryLock.ts's LOCK_KEYS.flipkart

function rawAppStoreClient(): Client {
  return new Client({
    host: config.appStore.host,
    port: config.appStore.port,
    database: config.appStore.database,
    user: config.appStore.user,
    password: config.appStore.password,
  });
}

describe("ingestion job locking (advisory-lock based, Phase 2.1 §1)", () => {
  beforeEach(async () => {
    await resetAppStore();
  });

  it("acquires a lock, marking status running (observability row)", async () => {
    await acquireLock("flipkart");
    const watermark = await IngestionWatermark.findByPk("flipkart");
    expect(watermark?.status).toBe("running");
    expect(watermark?.lockAcquiredAt).not.toBeNull();
    await releaseLock("flipkart");
  });

  it("refuses a second concurrent acquire while the lock is held", async () => {
    await acquireLock("flipkart");
    await expect(acquireLock("flipkart")).rejects.toBeInstanceOf(LockHeldError);
    await releaseLock("flipkart");
  });

  it("allows re-acquiring after release", async () => {
    await acquireLock("flipkart");
    await releaseLock("flipkart");
    await expect(acquireLock("flipkart")).resolves.not.toThrow();
    await releaseLock("flipkart");
  });

  it("locks are independent per platform", async () => {
    await acquireLock("flipkart");
    await expect(acquireLock("myntra")).resolves.not.toThrow();
    await releaseLock("flipkart");
    await releaseLock("myntra");
  });

  /**
   * Replaces the old "reclaims a stale lock" test, which simulated an
   * abandoned lock by editing lockAcquiredAt on the watermark row — that
   * scenario no longer maps to how locking works (Phase 2.1 §1). A session
   * advisory lock cannot go "stale": it is tied to the holding connection's
   * lifetime, so the only realistic way a lock outlives its owner is the
   * owning connection actually closing (a real crash). This test simulates
   * that directly rather than editing a timestamp.
   */
  it("a lock is immediately available again after the holding connection closes (crash simulation)", async () => {
    // A raw connection takes the advisory lock directly — standing in for a
    // real ingestion worker process — and then the connection is closed
    // WITHOUT calling pg_advisory_unlock first, simulating a hard crash
    // rather than a graceful shutdown.
    const crashedWorker = rawAppStoreClient();
    await crashedWorker.connect();
    const { rows } = await crashedWorker.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [FLIPKART_LOCK_KEY],
    );
    expect(rows[0]!.locked).toBe(true);

    // The lock is genuinely held — a concurrent acquire is refused.
    await expect(acquireLock("flipkart")).rejects.toBeInstanceOf(LockHeldError);

    // Simulate the crash: close the connection without unlocking.
    await crashedWorker.end();

    // PostgreSQL releases session advisory locks when the owning connection
    // closes, regardless of cause — so a fresh acquire must succeed
    // immediately, with no stale-lock timeout to wait out.
    await expect(acquireLock("flipkart")).resolves.not.toThrow();
    await releaseLock("flipkart");
  });
});
