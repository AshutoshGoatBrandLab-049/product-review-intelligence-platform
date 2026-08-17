/**
 * Phase 2 — local end-to-end ingestion & reconciliation validation.
 *
 * Drives the REAL Track A / Track B implementation (src/modules/ingestion/*)
 * against the local production-like dataset seeded in Phase 1.5
 * (gbl_data_lake.DataWarehouse.flipkart_reviews / myntra_reviews) — no
 * reimplementation, no mocks. `config.prodReadOnly` is pointed at that local
 * dataset via environment variables set on the shell invocation (see
 * package.json's "validate:phase2" script), never via a persistent .env
 * change — production's fail-loud default (DB_PROD_HOST=unset.invalid) is
 * untouched for every other command.
 *
 * Standalone dev/validation tool — not part of the ingestion pipeline or the
 * automated test suite.
 */
import { Client } from "pg";
import { config } from "../src/config/index.js";
import { runTrackA } from "../src/modules/ingestion/trackA.js";
import { runTrackB } from "../src/modules/ingestion/trackB.js";
import { acquireLock, releaseLock, getLastSeenSourceId } from "../src/modules/ingestion/watermarkRepo.js";
import { NormalizedReview } from "../src/database/appStore/models/normalizedReview.js";
import { IngestionReject } from "../src/database/appStore/models/ingestionReject.js";
import { isMainModule } from "../src/shared/isMainModule.js";

const LOCAL_SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function assertBothConnectionsAreLocal(): void {
  if (!LOCAL_SAFE_HOSTS.has(config.appStore.host) || !LOCAL_SAFE_HOSTS.has(config.prodReadOnly.host)) {
    throw new Error(
      `Refusing to run Phase 2 validation — both appStore.host (${config.appStore.host}) and ` +
        `prodReadOnly.host (${config.prodReadOnly.host}) must be local. This script never touches ` +
        `a non-local database, by design.`,
    );
  }
}

function section(title: string): void {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

interface MemorySample {
  peakRssMb: number;
  peakHeapUsedMb: number;
}

async function withMemorySampling<T>(fn: () => Promise<T>): Promise<{ result: T; memory: MemorySample }> {
  let peakRss = 0;
  let peakHeap = 0;
  const interval = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  }, 100);
  try {
    const result = await fn();
    return { result, memory: { peakRssMb: Math.round(peakRss / 1e6), peakHeapUsedMb: Math.round(peakHeap / 1e6) } };
  } finally {
    clearInterval(interval);
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

  const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await sql.query(text, values)).rows;

  try {
    // ── 2. Baseline inspection ────────────────────────────────────────────
    section("2. BASELINE INSPECTION");
    const [fkCount] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM "DataWarehouse".flipkart_reviews`);
    const [myCount] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM "DataWarehouse".myntra_reviews`);
    const [normCount] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM product_review_intelligence.normalized_reviews`);
    const [anomCount] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM product_review_intelligence.identity_anomalies`);
    const [rejCount] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM product_review_intelligence.ingestion_rejects`);
    const watermarks = await q(`SELECT * FROM product_review_intelligence.ingestion_watermarks`);
    console.log({ flipkartSource: fkCount!.count, myntraSource: myCount!.count, normalizedReviews: normCount!.count, identityAnomalies: anomCount!.count, ingestionRejects: rejCount!.count, watermarks });

    // ── 4. Track A — initial ingestion ──────────────────────────────────
    section("4. TRACK A — INITIAL INGESTION");
    await acquireLock("flipkart");
    const fkStart = Date.now();
    const { result: trackAFlipkart1, memory: fkMem } = await withMemorySampling(() => runTrackA("flipkart"));
    const fkDuration = Date.now() - fkStart;
    await releaseLock("flipkart");
    console.log("Flipkart Track A (run 1):", { ...trackAFlipkart1, durationMs: fkDuration, rowsPerSec: Math.round((trackAFlipkart1.rowsRead / fkDuration) * 1000), ...fkMem });

    await acquireLock("myntra");
    const myStart = Date.now();
    const { result: trackAMyntra1, memory: myMem } = await withMemorySampling(() => runTrackA("myntra"));
    const myDuration = Date.now() - myStart;
    await releaseLock("myntra");
    console.log("Myntra Track A (run 1):", { ...trackAMyntra1, durationMs: myDuration, rowsPerSec: Math.round((trackAMyntra1.rowsRead / myDuration) * 1000), ...myMem });

    // ── 5. Track A completeness ─────────────────────────────────────────
    section("5. TRACK A — COMPLETENESS");
    for (const platform of ["flipkart", "myntra"] as const) {
      const sourceTable = platform === "flipkart" ? "flipkart_reviews" : "myntra_reviews";
      const [srcTotal] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM "DataWarehouse".${sourceTable}`);
      const [normTotal] = await q<{ count: string }>(
        `SELECT count(*)::text AS count FROM product_review_intelligence.normalized_reviews WHERE platform = $1`,
        [platform],
      );
      const [rejTotal] = await q<{ count: string }>(
        `SELECT count(*)::text AS count FROM product_review_intelligence.ingestion_rejects WHERE platform = $1`,
        [platform],
      );
      const rejectReasons = await q(
        `SELECT reason, count(*) FROM product_review_intelligence.ingestion_rejects WHERE platform = $1 GROUP BY reason`,
        [platform],
      );
      console.log(platform, {
        sourceTotal: srcTotal!.count,
        normalizedTotal: normTotal!.count,
        rejectedTotal: rejTotal!.count,
        accountedFor: Number(normTotal!.count) + Number(rejTotal!.count),
        difference: Number(srcTotal!.count) - (Number(normTotal!.count) + Number(rejTotal!.count)),
        rejectReasons,
      });
    }

    // ── 6. Track A watermark ────────────────────────────────────────────
    section("6. TRACK A — WATERMARK");
    for (const platform of ["flipkart", "myntra"] as const) {
      const sourceTable = platform === "flipkart" ? "flipkart_reviews" : "myntra_reviews";
      const [srcMax] = await q<{ max: string }>(`SELECT max(id)::text AS max FROM "DataWarehouse".${sourceTable}`);
      const watermark = await getLastSeenSourceId(platform);
      console.log(platform, { sourceMaxId: srcMax!.max, watermark, matches: String(watermark) === srcMax!.max });
    }

    // ── 7. Track A idempotency ──────────────────────────────────────────
    section("7. TRACK A — IDEMPOTENCY (re-run, no source changes)");
    await acquireLock("flipkart");
    const trackAFlipkart2 = await runTrackA("flipkart");
    await releaseLock("flipkart");
    await acquireLock("myntra");
    const trackAMyntra2 = await runTrackA("myntra");
    await releaseLock("myntra");
    console.log("Flipkart Track A (run 2):", trackAFlipkart2);
    console.log("Myntra Track A (run 2):", trackAMyntra2);

    // ── 13. New-review test (insert AFTER first Track A run) ───────────
    section("13. NEW REVIEW TEST");
    await sql.query(
      `INSERT INTO "DataWarehouse".flipkart_reviews
         (brand_name, pid, review_id, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "createdAt", "updatedAt")
       VALUES ('CtrlBrand', 'PHASE2CTRL', 'CTRL-NEWROW-1', 5, 'Brand new', 'Inserted after the first Track A run to prove new-row detection.', CURRENT_DATE, 'https://www.flipkart.local/p/PHASE2CTRL', 'Test Ctrl', true, 0, 'India', now(), now())
       ON CONFLICT (pid, review_id) DO NOTHING`,
    );
    await acquireLock("flipkart");
    const newRowRun1 = await runTrackA("flipkart");
    await releaseLock("flipkart");
    await acquireLock("flipkart");
    const newRowRun2 = await runTrackA("flipkart");
    await releaseLock("flipkart");
    const newRowNormalized = await NormalizedReview.count({ where: { platform: "flipkart", sourceReviewId: "CTRL-NEWROW-1" } });
    console.log({ newRowRun1: { rowsRead: newRowRun1.rowsRead, rowsInserted: newRowRun1.rowsInserted }, newRowRun2: { rowsRead: newRowRun2.rowsRead, rowsInserted: newRowRun2.rowsInserted }, normalizedCountForNewRow: newRowNormalized });

    // ── 8. Track B — initial reconciliation ─────────────────────────────
    section("8. TRACK B — INITIAL RECONCILIATION");
    const trackBFlipkart1 = await runTrackB("flipkart");
    const trackBMyntra1 = await runTrackB("myntra");
    console.log("Flipkart Track B (run 1):", trackBFlipkart1);
    console.log("Myntra Track B (run 1):", trackBMyntra1);
    console.log(`Reconciliation window formula: today - (${config.ingestion.reconcileLookbackDays} + ${config.ingestion.reconcileSafetyBufferDays}) days = windowStart`);

    // ── 9. Track B no-change idempotency ────────────────────────────────
    section("9. TRACK B — NO-CHANGE RECONCILIATION (re-run, no source changes)");
    const trackBFlipkart2 = await runTrackB("flipkart");
    const trackBMyntra2 = await runTrackB("myntra");
    console.log("Flipkart Track B (run 2):", trackBFlipkart2);
    console.log("Myntra Track B (run 2):", trackBMyntra2);

    // ── 10. updatedAt-only test ──────────────────────────────────────────
    section("10. CRITICAL updatedAt TEST");
    const before10 = await NormalizedReview.findOne({ where: { platform: "flipkart", sourceReviewId: "CTRL-UPDATEDAT-1" } });
    const beforeHash = before10?.contentHash;
    await sql.query(`UPDATE "DataWarehouse".flipkart_reviews SET "updatedAt" = now() WHERE review_id = 'CTRL-UPDATEDAT-1'`);
    const trackBAfterUpdatedAt = await runTrackB("flipkart");
    const after10 = await NormalizedReview.findOne({ where: { platform: "flipkart", sourceReviewId: "CTRL-UPDATEDAT-1" } });
    console.log({
      beforeContentHash: beforeHash,
      afterContentHash: after10?.contentHash,
      hashUnchanged: beforeHash === after10?.contentHash,
      trackBResult: trackBAfterUpdatedAt,
    });

    // ── 11. content-change test ──────────────────────────────────────────
    section("11. CONTENT CHANGE TEST");
    const before11 = await NormalizedReview.findOne({ where: { platform: "flipkart", sourceReviewId: "CTRL-CONTENT-1" } });
    const beforeHash11 = before11?.contentHash;
    // Appends a fresh timestamp each run, so re-running this script always
    // produces a genuinely different value — never a no-op against a value
    // left over from a prior partial run.
    await sql.query(
      `UPDATE "DataWarehouse".flipkart_reviews SET comment = 'Completely rewritten review text for the content-change test — ' || now()::text, "updatedAt" = now() WHERE review_id = 'CTRL-CONTENT-1'`,
    );
    const trackBAfterContent = await runTrackB("flipkart");
    const after11 = await NormalizedReview.findOne({ where: { platform: "flipkart", sourceReviewId: "CTRL-CONTENT-1" } });
    console.log({
      beforeContentHash: beforeHash11,
      afterContentHash: after11?.contentHash,
      hashChanged: beforeHash11 !== after11?.contentHash,
      reviewTextUpdated: after11?.reviewText,
      trackBResult: trackBAfterContent,
    });

    // ── 12. rating-change test ───────────────────────────────────────────
    section("12. RATING CHANGE TEST");
    const before12 = await NormalizedReview.findOne({ where: { platform: "myntra", sourceReviewId: "CTRL-RATING-1" } });
    const beforeHash12 = before12?.contentHash;
    const beforeRating12 = before12?.rating;
    // Toggles between two values so a re-run always changes rating, even if a
    // prior partial run already flipped it once.
    await sql.query(
      `UPDATE "DataWarehouse".myntra_reviews SET rating = CASE WHEN rating = 1 THEN 2 ELSE 1 END, "updatedAt" = now() WHERE review_id = 'CTRL-RATING-1'`,
    );
    const trackBAfterRating = await runTrackB("myntra");
    const after12 = await NormalizedReview.findOne({ where: { platform: "myntra", sourceReviewId: "CTRL-RATING-1" } });
    console.log({
      beforeRating: beforeRating12,
      afterRating: after12?.rating,
      beforeContentHash: beforeHash12,
      afterContentHash: after12?.contentHash,
      hashChanged: beforeHash12 !== after12?.contentHash,
      trackBResult: trackBAfterRating,
      note: "final local fixture state: CTRL-RATING-1 now permanently rating=1 in DataWarehouse.myntra_reviews — documented, not restored",
    });

    // ── 14. duplicate test ────────────────────────────────────────────────
    section("14. DUPLICATE TEST");
    const dupCount = await NormalizedReview.count({ where: { platform: "flipkart", sourceReviewId: "CTRL-UPDATEDAT-1" } });
    console.log({
      canonicalRowCountForControlRow: dupCount,
      note: "CTRL-UPDATEDAT-1 has now been processed by Track A once and Track B three times (initial + 2 reconciliation passes) — exactly one canonical row must exist",
    });

    // ── 15. cross-platform identity test ───────────────────────────────
    section("15. CROSS-PLATFORM IDENTITY TEST");
    const fkXplat = await NormalizedReview.findOne({ where: { platform: "flipkart", sourceProductId: "777777", sourceReviewId: "XPLAT-SHARED-1" } });
    const myXplat = await NormalizedReview.findOne({ where: { platform: "myntra", sourceProductId: "777777", sourceReviewId: "XPLAT-SHARED-1" } });
    console.log({
      flipkartCanonicalId: fkXplat?.canonicalReviewId,
      myntraCanonicalId: myXplat?.canonicalReviewId,
      differ: fkXplat?.canonicalReviewId !== myXplat?.canonicalReviewId,
      sameSourceProductId: fkXplat?.sourceProductId === myXplat?.sourceProductId,
      sameSourceReviewId: fkXplat?.sourceReviewId === myXplat?.sourceReviewId,
    });

    // ── 24. error handling (malformed rows) ──────────────────────────────
    section("24. ERROR HANDLING (malformed rows)");
    const malformedRejects = await IngestionReject.findAll({
      where: { platform: "flipkart" },
      order: [["firstSeenAt", "ASC"]],
    });
    for (const r of malformedRejects) {
      console.log({ sourceReviewId: r.sourceReviewId, reason: r.reason, failedFields: r.failedFields });
    }

    // ── 19. Completeness audit ────────────────────────────────────────────
    section("19. DATA COMPLETENESS AUDIT");
    for (const platform of ["flipkart", "myntra"] as const) {
      const sourceTable = platform === "flipkart" ? "flipkart_reviews" : "myntra_reviews";
      const [srcTotal] = await q<{ count: string }>(`SELECT count(*)::text AS count FROM "DataWarehouse".${sourceTable}`);
      const [normTotal] = await q<{ count: string }>(
        `SELECT count(*)::text AS count FROM product_review_intelligence.normalized_reviews WHERE platform = $1`,
        [platform],
      );
      const [rejTotal] = await q<{ count: string }>(
        `SELECT count(*)::text AS count FROM product_review_intelligence.ingestion_rejects WHERE platform = $1`,
        [platform],
      );
      const [anomTotal] = await q<{ count: string }>(
        `SELECT count(*)::text AS count FROM product_review_intelligence.identity_anomalies WHERE platform = $1`,
        [platform],
      );
      console.log(platform, {
        MATCHED: normTotal!.count,
        REJECTED: rejTotal!.count,
        ANOMALY: anomTotal!.count,
        source: srcTotal!.count,
        explainedTotal: Number(normTotal!.count) + Number(rejTotal!.count),
        MISSING: Number(srcTotal!.count) - (Number(normTotal!.count) + Number(rejTotal!.count)),
      });
    }

    // ── 20. 30-day business window test ──────────────────────────────────
    section("20. 30-DAY BUSINESS WINDOW TEST (review_date, never updatedAt)");
    const windowRows = await q<{ platform: string; total: string; last_30d: string }>(
      `SELECT platform, count(*)::text AS total,
              count(*) FILTER (WHERE review_date >= current_date - 30)::text AS last_30d
       FROM product_review_intelligence.normalized_reviews GROUP BY platform`,
    );
    console.log(windowRows);
    const oldReviewRecentUpdate = await q<{ source_review_id: string; review_date: string; updated_at: string }>(
      `SELECT source_review_id, review_date::text, source_updated_at::text AS updated_at
       FROM product_review_intelligence.normalized_reviews
       WHERE source_review_id = 'CTRL-RATING-1'`,
    );
    console.log("CTRL-RATING-1 (old review_date + recently bumped updatedAt) — must NOT count in last-30-day window by review_date:", oldReviewRecentUpdate);

    // ── 21. 1-year historical window test ─────────────────────────────────
    section("21. 1-YEAR HISTORICAL WINDOW TEST");
    const historicalDist = await q(
      `SELECT
         count(*) FILTER (WHERE review_date >= current_date - 30) AS d0_30,
         count(*) FILTER (WHERE review_date < current_date - 30 AND review_date >= current_date - 60) AS d31_60,
         count(*) FILTER (WHERE review_date < current_date - 60 AND review_date >= current_date - 90) AS d61_90,
         count(*) FILTER (WHERE review_date < current_date - 90 AND review_date >= current_date - 180) AS d3_6mo,
         count(*) FILTER (WHERE review_date < current_date - 180) AS d6_12mo
       FROM product_review_intelligence.normalized_reviews`,
    );
    console.log(historicalDist);

    section("DONE");
    console.log("PRODUCTION DATABASE ACCESSED: NO — config.prodReadOnly was pointed at localhost for this run only, via shell-level env vars, never .env.");
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
