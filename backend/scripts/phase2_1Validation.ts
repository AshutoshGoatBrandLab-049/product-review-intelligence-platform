/**
 * Phase 2.1 — re-validation against the real local 100K dataset.
 *
 * Focused on the 3 hardened areas (locking, reject dedup, completeness) plus
 * a performance comparison — the broader Track A/B correctness properties
 * were already re-proven by the full vitest suite (111 tests, including new
 * rejectDeduplication/completenessAudit/concurrency/observability files) and
 * are not blindly re-asserted here. Uses the real Track A/B code, same as
 * phase2Validation.ts. Never touches production — see confirmations at the
 * end.
 */
import { Client } from "pg";
import { config } from "../src/config/index.js";
import { runTrackA } from "../src/modules/ingestion/trackA.js";
import { runTrackB } from "../src/modules/ingestion/trackB.js";
import { acquireLock, releaseLock, LockHeldError } from "../src/modules/ingestion/watermarkRepo.js";
import { computeCompletenessAudit } from "../src/modules/ingestion/shared/completenessAudit.js";
import { IngestionReject } from "../src/database/appStore/models/ingestionReject.js";
import { isMainModule } from "../src/shared/isMainModule.js";

const LOCAL_SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
function assertBothConnectionsAreLocal(): void {
  if (!LOCAL_SAFE_HOSTS.has(config.appStore.host) || !LOCAL_SAFE_HOSTS.has(config.prodReadOnly.host)) {
    throw new Error("Refusing to run — both connections must be local.");
  }
}

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

type WorkerOutcome = "ran" | "blocked" | "crashed";
async function raceWorker(platform: "flipkart" | "myntra"): Promise<WorkerOutcome> {
  try {
    await acquireLock(platform);
  } catch (err) {
    if (err instanceof LockHeldError) return "blocked";
    return "crashed";
  }
  try {
    await runTrackA(platform);
    return "ran";
  } finally {
    await releaseLock(platform);
  }
}

async function main(): Promise<void> {
  assertBothConnectionsAreLocal();

  const sql = new Client({
    host: config.appStore.host,
    port: config.appStore.port,
    database: config.appStore.database,
    user: config.appStore.user,
    password: config.appStore.password,
  });
  await sql.connect();

  try {
    // ── Performance re-measurement (§6) ─────────────────────────────────
    section("PERFORMANCE RE-MEASUREMENT");
    const fkStart = Date.now();
    const fkResult = await runTrackA("flipkart");
    const fkDuration = Date.now() - fkStart;
    console.log("Flipkart Track A:", {
      rowsRead: fkResult.rowsRead,
      rowsInserted: fkResult.rowsInserted,
      durationMs: fkDuration,
      rowsPerSec: fkResult.rowsRead > 0 ? Math.round((fkResult.rowsRead / fkDuration) * 1000) : 0,
      status: fkResult.status,
      jobId: fkResult.jobId,
    });

    const myStart = Date.now();
    const myResult = await runTrackA("myntra");
    const myDuration = Date.now() - myStart;
    console.log("Myntra Track A:", {
      rowsRead: myResult.rowsRead,
      rowsInserted: myResult.rowsInserted,
      durationMs: myDuration,
      rowsPerSec: myResult.rowsRead > 0 ? Math.round((myResult.rowsRead / myDuration) * 1000) : 0,
      status: myResult.status,
      jobId: myResult.jobId,
    });

    const tbStart = Date.now();
    const tbFk = await runTrackB("flipkart");
    const tbFkDuration = Date.now() - tbStart;
    console.log("Flipkart Track B:", { ...tbFk, wallDurationMs: tbFkDuration });

    const tbMyStart = Date.now();
    const tbMy = await runTrackB("myntra");
    const tbMyDuration = Date.now() - tbMyStart;
    console.log("Myntra Track B:", { ...tbMy, wallDurationMs: tbMyDuration });

    // ── Reject dedup at scale (§12) — run Track B 10 more times ─────────
    section("REJECT DEDUPLICATION AT SCALE (10 additional Track B passes)");
    for (let i = 0; i < 10; i++) {
      await runTrackB("flipkart");
    }
    const rejectRows = await IngestionReject.findAll({ where: { platform: "flipkart" } });
    console.log({
      totalRejectRowsAfter10ExtraPasses: rejectRows.length,
      byReasonAndOccurrence: rejectRows.map((r) => ({
        sourceRowId: r.sourceRowId,
        reason: r.reason,
        occurrenceCount: r.occurrenceCount,
      })),
    });

    // ── Completeness audit (§3) ──────────────────────────────────────────
    section("COMPLETENESS AUDIT");
    const [fkSourceCount] = (
      await sql.query(`SELECT count(*)::text AS count FROM "DataWarehouse".flipkart_reviews`)
    ).rows;
    const [mySourceCount] = (
      await sql.query(`SELECT count(*)::text AS count FROM "DataWarehouse".myntra_reviews`)
    ).rows;
    const fkAudit = await computeCompletenessAudit("flipkart", Number(fkSourceCount.count));
    const myAudit = await computeCompletenessAudit("myntra", Number(mySourceCount.count));
    console.log("Flipkart:", fkAudit);
    console.log("Myntra:", myAudit);

    // ── Concurrency race at real scale (§11) ─────────────────────────────
    section("CONCURRENCY RACE — 20 ITERATIONS AGAINST REAL DATASET");
    let ran = 0;
    let blocked = 0;
    let crashed = 0;
    for (let i = 0; i < 20; i++) {
      const [a, b] = await Promise.allSettled([raceWorker("flipkart"), raceWorker("flipkart")]);
      const outcomes = [a, b].map((r) => (r.status === "fulfilled" ? r.value : "crashed"));
      for (const o of outcomes) {
        if (o === "ran") ran++;
        else if (o === "blocked") blocked++;
        else crashed++;
      }
    }
    console.log({ iterations: 20, ranCount: ran, blockedCount: blocked, crashedCount: crashed });

    section("DONE");
    console.log("PRODUCTION DATABASE ACCESSED: NO");
  } finally {
    await sql.end();
  }
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
