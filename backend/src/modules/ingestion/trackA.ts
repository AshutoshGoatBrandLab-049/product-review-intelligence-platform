import { randomUUID } from "node:crypto";
import * as prodReadOnly from "../../database/prodReadOnly/index.js";
import { NormalizedReview } from "../../database/appStore/models/normalizedReview.js";
import { appSequelize } from "../../database/appStore/client.js";
import { advanceLastSeenSourceId, getLastSeenSourceId } from "./watermarkRepo.js";
import { computeCanonicalReviewId } from "./shared/canonicalId.js";
import { computeContentHash } from "./shared/contentHash.js";
import { validateUnifiedReview } from "./shared/validators.js";
import { recordReject } from "./shared/rejectRecorder.js";
import { mapFlipkartReview, FLIPKART_MAPPER_VERSION } from "./flipkart/mapper.js";
import { mapMyntraReview, MYNTRA_MAPPER_VERSION } from "./myntra/mapper.js";
import { config } from "../../config/index.js";
import type { Platform, UnifiedReview } from "../../types/unifiedReview.js";
import { logger } from "../../shared/logger.js";
import { webSocketEventEmitter } from "../websocket/eventEmitter.js";
import { synchronizeProductDimension, synchronizeProductDailyMetrics } from "../analytics/synchronize.js";
import type { AffectedProduct } from "../analytics/synchronize.js";
import {
  getReplacementSignals,
  cleanupStaleSourceData,
  hasStaleCanonicalRows,
  listProductsWithReviews,
  type ReplacementCleanupResult,
  type ReplacementSignals,
} from "./sourceReplacement.js";

export interface TrackAResult {
  platform: Platform;
  jobId: string;
  batchesProcessed: number;
  rowsRead: number;
  rowsInserted: number;
  rowsRejected: number;
  finalLastSeenSourceId: number;
  durationMs: number;
  status: "success" | "failed";
}

function mapRawRows(platform: Platform, rows: unknown[]): UnifiedReview[] {
  if (platform === "flipkart") {
    return (rows as Parameters<typeof mapFlipkartReview>[0][]).map((r) => mapFlipkartReview(r));
  }
  return (rows as Parameters<typeof mapMyntraReview>[0][]).map((r) => mapMyntraReview(r));
}

function mapperVersion(platform: Platform): number {
  return platform === "flipkart" ? FLIPKART_MAPPER_VERSION : MYNTRA_MAPPER_VERSION;
}

/**
 * New-row detection: WHERE id > last_seen_source_id ORDER BY id — PK-indexed,
 * cheap regardless of table size, no new production index required.
 *
 * Checkpoint rule: last_seen_source_id advances only after the corresponding
 * insert commits, in the SAME transaction (Phase 1 plan §I).
 *
 * `jobId` (Phase 2.1 §4) correlates every log line from one ingestion run —
 * defaults to a fresh UUID so existing callers (tests, ad-hoc scripts) that
 * don't pass one keep working unchanged.
 */
export async function runTrackA(platform: Platform, jobId: string = randomUUID()): Promise<TrackAResult> {
  const startedAt = Date.now();
  const batchSize = config.ingestion.batchSize;
  let afterId = await getLastSeenSourceId(platform);
  const sourceAfterIdStart = afterId;

  /**
   * Replacement detection runs UNCONDITIONALLY, before anything else.
   *
   * It used to run only when the first keyset batch came back empty, which made
   * detection depend on the very cursor that a replacement corrupts. Two ways
   * that failed:
   *   - watermark stranded ABOVE source MAX(id) (the live Myntra case: 52,329 >
   *     27,310) — every batch query returns nothing forever;
   *   - watermark BELOW source MAX(id) — Track A happily ingests "new" rows and
   *     never checks for replacement at all, silently mixing two datasets.
   * Neither is a property of the source data, so neither belongs in the trigger.
   */
  const signals = await getReplacementSignals(platform);
  const isReplacement = signals.isReplacement;

  logger.info(
    {
      jobId,
      platform,
      sourceCount: signals.sourceCount,
      sourceMaxId: signals.sourceMaxId,
      canonicalCount: signals.canonicalCount,
      retainedCount: signals.retainedCount,
      retention: signals.retention === null ? null : Number(signals.retention.toFixed(4)),
      watermark: afterId,
      watermarkStranded: afterId > signals.sourceMaxId,
      isReplacement,
      reason: signals.reason,
    },
    "Track A replacement check",
  );

  if (isReplacement) {
    return runReplacementSync(platform, jobId, signals, startedAt, sourceAfterIdStart);
  }

  /**
   * WATERMARK-AHEAD GUARD — silent-data-loss protection.
   *
   * Track A discovers rows with `WHERE id > watermark`, keyed on the primary key
   * and NOT on review_date. When the watermark sits above the source's MAX(id),
   * every row at or below it is unreachable: the keyset scan steps straight over
   * them, forever, with no error and nothing surfaced.
   *
   * Two real ways to land there:
   *   - a historical backfill that PRESERVES upstream ids, writing rows below a
   *     watermark the sequence has already run past (verified: a row at id 1,173
   *     under a watermark of 52,467 was never ingested);
   *   - a source reload that resets the sequence, leaving the watermark stranded.
   *
   * Neither is a replacement — retention stays high, so that path does not fire.
   * The response is to distrust the cursor for exactly one run: scan from id > 0,
   * which is safe because inserts are ON CONFLICT DO NOTHING (already-present
   * rows are no-ops), and let the loop rewrite the watermark from what it finds.
   * The next run returns to a normal incremental scan, so this self-heals rather
   * than permanently converting every run into a full scan.
   */
  const watermarkAhead = afterId > signals.sourceMaxId;
  if (watermarkAhead) {
    logger.warn(
      {
        jobId,
        platform,
        watermark: afterId,
        sourceMaxId: signals.sourceMaxId,
        unreachableRows: signals.sourceCount,
      },
      "Watermark is AHEAD of source MAX(id) — rows at or below it are unreachable. " +
        "Falling back to a full scan for this run and rebuilding the watermark.",
    );
    afterId = 0;
  }

  const result: TrackAResult = {
    platform,
    jobId,
    batchesProcessed: 0,
    rowsRead: 0,
    rowsInserted: 0,
    rowsRejected: 0,
    finalLastSeenSourceId: afterId,
    durationMs: 0,
    status: "success",
  };

  try {
    for (;;) {
      const batchStartedAt = Date.now();
      const rawRows =
        platform === "flipkart"
          ? await prodReadOnly.getFlipkartReviewsPage(afterId, batchSize)
          : await prodReadOnly.getMyntraReviewsPage(afterId, batchSize);

      if (rawRows.length === 0) break;

      result.batchesProcessed += 1;
      result.rowsRead += rawRows.length;

      const unified = mapRawRows(platform, rawRows);
      const maxIdInBatch = Math.max(...rawRows.map((r) => (r as { id: number }).id));

      const toInsert: Array<ReturnType<typeof buildRow>> = [];

      for (const review of unified) {
        const validation = validateUnifiedReview(review);

        if (validation.outcome === "reject") {
          result.rowsRejected += 1;
          await recordReject({
            platform,
            sourceRowId: review.sourceRowId,
            sourceProductId: review.sourceProductId || null,
            sourceReviewId: review.sourceReviewId || null,
            reason: validation.reason,
            failedFields: validation.failedFields,
          });
          continue;
        }

        toInsert.push(buildRow(review, mapperVersion(platform)));
      }

      /**
       * Determine which rows are ACTUALLY new before doing anything with them.
       *
       * The insert below is ON CONFLICT DO NOTHING, so a row already in canonical
       * is silently skipped. Treating every mapped row as "affected" therefore
       * produced work and events for rows that were never written — harmless on a
       * normal incremental scan (the keyset only returns rows above the watermark,
       * so they really are new), but catastrophic on a full rescan: the
       * watermark-ahead guard re-reads the entire source, and the old code then
       * emitted one PRODUCT_DATA_UPDATED per product for the whole catalogue.
       * Measured: a single delete produced 98 broadcasts and 196 browser
       * refetches, with `rowsInserted` reporting 21,647 rows that were not
       * inserted.
       *
       * One indexed lookup per batch settles it, and makes rowsInserted honest.
       */
      const alreadyPresent =
        toInsert.length === 0
          ? new Set<string>()
          : new Set(
              (
                await NormalizedReview.findAll({
                  attributes: ["canonicalReviewId"],
                  where: { canonicalReviewId: toInsert.map((r) => r.canonicalReviewId) },
                  raw: true,
                })
              ).map((r) => (r as unknown as { canonicalReviewId: string }).canonicalReviewId),
            );

      const newRows = toInsert.filter((r) => !alreadyPresent.has(r.canonicalReviewId));

      // Only genuinely new rows count as affected — and therefore as events.
      const affectedProducts = new Map<string, AffectedProduct>();
      for (const row of newRows) {
        const key = `${row.platform}:${row.sourceProductId}`;
        affectedProducts.set(key, {
          platform: row.platform,
          sourceProductId: row.sourceProductId,
        });
      }

      // CRITICAL: Synchronize within transaction boundary, emit event only AFTER commit
      await appSequelize.transaction(async (t) => {
        if (newRows.length > 0) {
          await NormalizedReview.bulkCreate(newRows, {
            transaction: t,
            ignoreDuplicates: true, // harmless overlap with Track B — ON CONFLICT DO NOTHING
          });
        }

        // Synchronize product analytics WITHIN transaction
        const products = Array.from(affectedProducts.values());
        if (products.length > 0) {
          await synchronizeProductDimension(products, t);
          await synchronizeProductDailyMetrics(products, t);
        }

        await advanceLastSeenSourceId(platform, maxIdInBatch, t);
      });

      // ONLY AFTER successful commit: emit WebSocket events
      for (const product of affectedProducts.values()) {
        try {
          webSocketEventEmitter.broadcastEvent({
            type: "PRODUCT_DATA_UPDATED",
            platform: product.platform,
            sourceProductId: product.sourceProductId,
            changedAt: new Date().toISOString(),
            changes: {
              reviews: true,
              productDimension: true,
              dailyMetrics: true,
            },
          });
        } catch (err) {
          logger.error(
            {
              jobId,
              platform: product.platform,
              sourceProductId: product.sourceProductId,
              error: (err as Error).message,
            },
            "Failed to broadcast product update event",
          );
          // Do NOT rollback database on WebSocket failure - continue
        }
      }

      result.rowsInserted += newRows.length;
      afterId = maxIdInBatch;
      result.finalLastSeenSourceId = afterId;

      logger.info(
        {
          jobId,
          platform,
          track: "A",
          batch: result.batchesProcessed,
          sourceAfterId: afterId,
          rowsRead: rawRows.length,
          rowsInserted: newRows.length,
          rowsRejected: result.rowsRejected,
          durationMs: Date.now() - batchStartedAt,
          status: "success",
        },
        "Track A batch complete",
      );

      if (rawRows.length < batchSize) break;
    }
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startedAt;
    logger.error(
      { jobId, platform, track: "A", status: "failed", durationMs: result.durationMs, error: (err as Error).message },
      "Track A run failed",
    );
    throw err;
  }

  // Reconcile DELETIONS. The batch loop above only ever discovers rows with
  // id > watermark, so it is structurally blind to source rows that were
  // removed — and retention stays far above the replacement threshold when only
  // a handful disappear, so the replacement path never fires either. Without
  // this step a deleted source review lingers in canonical, in the rankings and
  // in the UI indefinitely: the same defect as the original 16,876-ghost bug,
  // just below the threshold that makes it visible.
  //
  // Gated on a bounded LIMIT 1 probe, so a clean run pays almost nothing and
  // performs ZERO writes — no rows touched, no last_rebuilt_at churn, and
  // therefore no change to the idempotency guarantee.
  await reconcileDeletions(platform, jobId, result);

  result.durationMs = Date.now() - startedAt;

  logger.info(
    {
      jobId,
      platform,
      track: "A",
      mode: "incremental",
      sourceRange: `${sourceAfterIdStart}-${result.finalLastSeenSourceId}`,
      batchesProcessed: result.batchesProcessed,
      rowsRead: result.rowsRead,
      rowsInserted: result.rowsInserted,
      rowsRejected: result.rowsRejected,
      sourceReplacement: false,
      durationMs: result.durationMs,
      status: result.status,
    },
    "Track A run complete",
  );

  return result;
}

/**
 * Remove canonical rows whose source rows were deleted, outside of a full
 * replacement, and rebuild analytics for exactly the products affected.
 *
 * Runs after every incremental Track A pass. The bounded probe means the common
 * case (nothing deleted) costs one LIMIT 1 lookup and writes nothing at all, so
 * a repeated run over an unchanged source stays a true no-op.
 *
 * Atomic: deletion and analytics rebuild share one transaction, and events are
 * emitted only after it commits.
 */
async function reconcileDeletions(
  platform: Platform,
  jobId: string,
  result: TrackAResult,
): Promise<void> {
  // SAFETY GUARD — must come first.
  //
  // Against an empty source EVERY canonical row looks stale, so running the
  // cleanup would delete the entire dataset. That is precisely what the
  // empty-source guard in getReplacementSignals refuses to do, and this path
  // has to honour the same rule: an empty source means "the source is mid-reload
  // or the crawl failed", never "the marketplace deleted everything".
  //
  // Costs only the cheap counts query — the guard branches return before the
  // retention join is ever issued.
  const signals = await getReplacementSignals(platform);
  if (signals.sourceCount === 0) {
    logger.warn(
      { jobId, platform, canonicalCount: signals.canonicalCount },
      "Source is empty — refusing to reconcile deletions (canonical preserved)",
    );
    return;
  }

  if (!(await hasStaleCanonicalRows(platform))) return;

  logger.info({ jobId, platform }, "Stale canonical rows detected — reconciling deletions");

  let cleanup: ReplacementCleanupResult | null = null;

  await appSequelize.transaction(async (t) => {
    cleanup = await cleanupStaleSourceData(platform, t);
    if (cleanup.affectedProducts.length > 0) {
      await synchronizeProductDimension(cleanup.affectedProducts, t);
      await synchronizeProductDailyMetrics(cleanup.affectedProducts, t);
    }
  });

  const c = cleanup as unknown as ReplacementCleanupResult;

  logger.info(
    {
      jobId,
      platform,
      staleReviewsDeleted: c.staleReviewsDeleted,
      staleProductsDeleted: c.staleProductsDeleted,
      staleMetricsDeleted: c.staleMetricsDeleted,
      resynchronizedProducts: c.affectedProducts.length,
      removedProducts: c.removedProducts.length,
    },
    "Deletion reconciliation complete",
  );

  // ONLY AFTER COMMIT: notify.
  //
  // BOTH sets must be announced. Products whose last review was deleted cannot be
  // re-synchronized — there is nothing left to rebuild — but a client currently
  // displaying them still has to learn they are gone. Emitting for survivors only
  // left deleted products sitting on screen until a manual refresh.
  for (const product of [...c.affectedProducts, ...c.removedProducts]) {
    try {
      webSocketEventEmitter.broadcastEvent({
        type: "PRODUCT_DATA_UPDATED",
        platform: product.platform,
        sourceProductId: product.sourceProductId,
        changedAt: new Date().toISOString(),
        changes: { reviews: true, productDimension: true, dailyMetrics: true },
      });
    } catch (err) {
      logger.error(
        { jobId, platform, sourceProductId: product.sourceProductId, error: (err as Error).message },
        "Failed to broadcast product update event after deletion reconciliation",
      );
    }
  }
}

/**
 * Full source resynchronization, used when replacement is confirmed.
 *
 * ATOMIC ACROSS THE WHOLE OPERATION — not per batch. The incremental path
 * commits each batch separately, which is correct there (each batch is an
 * independent forward step). A replacement is not decomposable that way: a
 * per-batch commit would publish an intermediate state where the old dataset
 * has been deleted but only part of the new one inserted, and readers would see
 * a half-replaced catalog. Everything below happens inside ONE transaction, so
 * the dataset switches over exactly once, or not at all.
 *
 * The watermark is bypassed entirely (full scan from id > 0) and then REWRITTEN
 * to the current source MAX(id). That rewrite is the only thing that rescues a
 * watermark stranded above the source's id range, and it is reachable ONLY from
 * this verified-replacement path — never from a bare "MAX(id) went down"
 * observation, which could be an ordinary deletion.
 */
async function runReplacementSync(
  platform: Platform,
  jobId: string,
  signals: ReplacementSignals,
  startedAt: number,
  sourceAfterIdStart: number,
): Promise<TrackAResult> {
  const batchSize = config.ingestion.batchSize;

  const result: TrackAResult = {
    platform,
    jobId,
    batchesProcessed: 0,
    rowsRead: 0,
    rowsInserted: 0,
    rowsRejected: 0,
    finalLastSeenSourceId: sourceAfterIdStart,
    durationMs: 0,
    status: "success",
  };

  logger.info(
    {
      jobId,
      platform,
      sourceCount: signals.sourceCount,
      sourceMaxId: signals.sourceMaxId,
      canonicalCount: signals.canonicalCount,
      retention: signals.retention,
      staleWatermark: sourceAfterIdStart,
    },
    "Source replacement confirmed — full resynchronization starting",
  );

  // Read and validate the ENTIRE current source before opening the write
  // transaction, so the transaction holds locks for as short a time as possible.
  const toInsert: Array<ReturnType<typeof buildRow>> = [];
  let scanId = 0;
  for (;;) {
    const rawRows =
      platform === "flipkart"
        ? await prodReadOnly.getFlipkartReviewsPage(scanId, batchSize)
        : await prodReadOnly.getMyntraReviewsPage(scanId, batchSize);

    if (rawRows.length === 0) break;

    result.batchesProcessed += 1;
    result.rowsRead += rawRows.length;
    scanId = Math.max(...rawRows.map((r) => (r as { id: number }).id));

    for (const review of mapRawRows(platform, rawRows)) {
      const validation = validateUnifiedReview(review);
      if (validation.outcome === "reject") {
        result.rowsRejected += 1;
        await recordReject({
          platform,
          sourceRowId: review.sourceRowId,
          sourceProductId: review.sourceProductId || null,
          sourceReviewId: review.sourceReviewId || null,
          reason: validation.reason,
          failedFields: validation.failedFields,
        });
        continue;
      }
      toInsert.push(buildRow(review, mapperVersion(platform)));
    }

    if (rawRows.length < batchSize) break;
  }

  let cleanupResult: ReplacementCleanupResult | null = null;
  let affectedProducts: AffectedProduct[] = [];

  try {
    await appSequelize.transaction(async (t) => {
      // 1. Insert the current source dataset. ignoreDuplicates (ON CONFLICT DO
      //    NOTHING) keeps this idempotent: a second identical run writes zero
      //    rows and touches no business values. Content CHANGES to rows that
      //    still exist are Track B's job, gated on content_hash.
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += batchSize) {
          await NormalizedReview.bulkCreate(toInsert.slice(i, i + batchSize), {
            transaction: t,
            ignoreDuplicates: true,
          });
        }
      }

      // 2. Remove canonical rows, products and metrics that the current source
      //    no longer contains — the step whose absence left 16,876 ghosts.
      cleanupResult = await cleanupStaleSourceData(platform, t);

      // A replacement makes EVERY surviving product new or changed, so analytics
      // must be rebuilt for all of them — not just the ones cleanup happened to
      // touch (cleanupStaleSourceData now reports only the latter, which is what
      // keeps the incremental path idempotent).
      affectedProducts = await listProductsWithReviews(platform, t);

      // 3. Rebuild derived analytics for everything that survived.
      if (affectedProducts.length > 0) {
        await synchronizeProductDimension(affectedProducts, t);
        await synchronizeProductDailyMetrics(affectedProducts, t);
      }

      // 4. Rewrite the watermark from the post-sync source reality.
      await advanceLastSeenSourceId(platform, signals.sourceMaxId, t);

      // 5. Validate BEFORE commit. Re-reading signals inside the transaction
      //    proves canonical now equals source; anything else throws and rolls
      //    the whole replacement back rather than committing a broken dataset.
      //
      //    exact: true is REQUIRED here. The default bounded scan stops once the
      //    verdict is settled, so retainedCount is a lower bound — comparing that
      //    against canonicalCount would fail on every successful replacement.
      //    This is an audit, not a verdict, so it needs the true count.
      const post = await getReplacementSignals(platform, t, { exact: true });
      if (post.canonicalCount !== post.sourceCount || post.retainedCount !== post.canonicalCount) {
        throw new Error(
          `Replacement consistency check FAILED for ${platform}: ` +
            `source=${post.sourceCount} canonical=${post.canonicalCount} retained=${post.retainedCount}. ` +
            `Rolling back.`,
        );
      }

      logger.info(
        {
          jobId,
          platform,
          sourceCount: post.sourceCount,
          canonicalCount: post.canonicalCount,
          retainedCount: post.retainedCount,
        },
        "Replacement consistency check PASSED — committing",
      );
    });
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startedAt;
    logger.error(
      { jobId, platform, track: "A", error: (err as Error).message },
      "Source replacement FAILED — transaction rolled back, no events emitted",
    );
    throw err; // No WebSocket event may be emitted for a failed transaction.
  }

  result.rowsInserted = toInsert.length;
  result.finalLastSeenSourceId = signals.sourceMaxId;
  result.durationMs = Date.now() - startedAt;

  // ONLY AFTER COMMIT: emit events.
  for (const product of affectedProducts) {
    try {
      webSocketEventEmitter.broadcastEvent({
        type: "PRODUCT_DATA_UPDATED",
        platform: product.platform,
        sourceProductId: product.sourceProductId,
        changedAt: new Date().toISOString(),
        changes: { reviews: true, productDimension: true, dailyMetrics: true },
      });
    } catch (err) {
      logger.error(
        { jobId, platform, sourceProductId: product.sourceProductId, error: (err as Error).message },
        "Failed to broadcast product update event",
      );
    }
  }

  const stats = cleanupResult ?? { staleReviewsDeleted: 0, staleProductsDeleted: 0, staleMetricsDeleted: 0 };
  logger.info(
    {
      jobId,
      platform,
      track: "A",
      mode: "replacement",
      rowsRead: result.rowsRead,
      rowsInserted: result.rowsInserted,
      rowsRejected: result.rowsRejected,
      staleReviewsDeleted: stats.staleReviewsDeleted,
      staleProductsDeleted: stats.staleProductsDeleted,
      staleMetricsDeleted: stats.staleMetricsDeleted,
      watermarkBefore: sourceAfterIdStart,
      watermarkAfter: result.finalLastSeenSourceId,
      affectedProducts: affectedProducts.length,
      durationMs: result.durationMs,
      status: result.status,
    },
    "Track A replacement run complete",
  );

  return result;
}

function buildRow(review: UnifiedReview, mapperVer: number) {
  return {
    canonicalReviewId: computeCanonicalReviewId(
      review.platform,
      review.sourceProductId,
      review.sourceReviewId,
    ),
    platform: review.platform,
    sourceProductId: review.sourceProductId,
    sourceReviewId: review.sourceReviewId,
    sourceRowId: review.sourceRowId,
    identityConfidence: review.identityConfidence,
    brand: review.brand,
    rating: review.rating,
    title: review.title,
    reviewText: review.reviewText,
    author: review.author,
    helpfulCount: review.helpfulCount,
    notHelpfulCount: review.notHelpfulCount,
    country: review.country,
    productUrl: review.productUrl,
    reviewDate: review.reviewDate,
    reviewTimestamp: review.reviewTimestamp,
    dateConfidence: review.dateConfidence,
    verifiedPurchase: review.verifiedPurchase,
    hasImages: review.hasImages,
    imageUrls: review.imageUrls,
    sizePurchased: review.sizePurchased,
    colorPurchased: review.colorPurchased,
    contentHash: computeContentHash(review),
    sourceUpdatedAt: review.sourceUpdatedAt,
    sourceExtra: review.sourceExtra,
    mapperVersion: mapperVer,
  };
}
