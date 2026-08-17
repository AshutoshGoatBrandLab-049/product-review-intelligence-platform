import { randomUUID } from "node:crypto";
import * as prodReadOnly from "../../database/prodReadOnly/index.js";
import { NormalizedReview } from "../../database/appStore/models/normalizedReview.js";
import { IdentityAnomaly } from "../../database/appStore/models/identityAnomaly.js";
import { appSequelize } from "../../database/appStore/client.js";
import { recordReconciliationRun } from "./watermarkRepo.js";
import { computeCanonicalReviewId } from "./shared/canonicalId.js";
import { computeContentHash } from "./shared/contentHash.js";
import { validateUnifiedReview } from "./shared/validators.js";
import { recordReject } from "./shared/rejectRecorder.js";
import { mapFlipkartReview, FLIPKART_MAPPER_VERSION } from "./flipkart/mapper.js";
import { mapMyntraReview, MYNTRA_MAPPER_VERSION } from "./myntra/mapper.js";
import { config } from "../../config/index.js";
import type { Platform, UnifiedReview } from "../../types/unifiedReview.js";
import { logger } from "../../shared/logger.js";

export interface TrackBResult {
  platform: Platform;
  jobId: string;
  windowStart: string;
  rowsScanned: number;
  rowsInserted: number;
  rowsUnchanged: number;
  rowsUpdated: number;
  rowsRejected: number;
  identityAnomaliesDetected: number;
  durationMs: number;
  status: "success" | "failed";
}

function windowStartDate(): string {
  const totalDays = config.ingestion.reconcileLookbackDays + config.ingestion.reconcileSafetyBufferDays;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - totalDays);
  return d.toISOString().slice(0, 10);
}

function mapRawRow(platform: Platform, row: unknown): UnifiedReview {
  return platform === "flipkart"
    ? mapFlipkartReview(row as Parameters<typeof mapFlipkartReview>[0])
    : mapMyntraReview(row as Parameters<typeof mapMyntraReview>[0]);
}

function mapperVersion(platform: Platform): number {
  return platform === "flipkart" ? FLIPKART_MAPPER_VERSION : MYNTRA_MAPPER_VERSION;
}

/** A hash mismatch this broad looks like a wholesale identity swap rather
 * than a minor edit — exactly the symptom of a Flipkart review_id collision
 * (Phase 2.5 §4D). Logged, never silently absorbed. */
function looksLikeIdentitySwap(existing: NormalizedReview, fresh: UnifiedReview): boolean {
  const authorChanged = (existing.author ?? "") !== (fresh.author ?? "");
  const titleChanged = (existing.title ?? "") !== (fresh.title ?? "");
  const ratingChanged = existing.rating !== fresh.rating;
  return [authorChanged, titleChanged, ratingChanged].filter(Boolean).length >= 2;
}

/**
 * Bounded reconciliation: SELECT-only from production, review_date-windowed,
 * content_hash-gated. Never trusts updatedAt to mean "changed" — the crawler
 * bumps it unconditionally on every re-crawl regardless of actual content
 * change (Phase 2.6). Safe to rerun: a second pass with no source changes
 * produces zero normalized-row writes — and, since Phase 2.1 §2, zero new
 * reject rows for an already-known-invalid row too (recordReject upserts by
 * (platform, source_row_id, reason) instead of always inserting).
 *
 * `jobId` (Phase 2.1 §4) correlates every log line from one ingestion run.
 */
export async function runTrackB(platform: Platform, jobId: string = randomUUID()): Promise<TrackBResult> {
  const startedAt = Date.now();
  const windowStart = windowStartDate();
  const batchSize = config.ingestion.batchSize;

  const result: TrackBResult = {
    platform,
    jobId,
    windowStart,
    rowsScanned: 0,
    rowsInserted: 0,
    rowsUnchanged: 0,
    rowsUpdated: 0,
    rowsRejected: 0,
    identityAnomaliesDetected: 0,
    durationMs: 0,
    status: "success",
  };

  let afterId = 0;

  try {
    for (;;) {
      const batchStartedAt = Date.now();
      const rawRows =
        platform === "flipkart"
          ? await prodReadOnly.getFlipkartReviewsByDateWindow(windowStart, afterId, batchSize)
          : await prodReadOnly.getMyntraReviewsByDateWindow(windowStart, afterId, batchSize);

      if (rawRows.length === 0) break;

      result.rowsScanned += rawRows.length;
      afterId = Math.max(...rawRows.map((r) => (r as { id: number }).id));

      for (const raw of rawRows) {
        const review = mapRawRow(platform, raw);
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

        const canonicalReviewId = computeCanonicalReviewId(
          review.platform,
          review.sourceProductId,
          review.sourceReviewId,
        );
        const freshHash = computeContentHash(review);

        const existing = await NormalizedReview.findByPk(canonicalReviewId);

        if (!existing) {
          await NormalizedReview.create(buildRow(review, freshHash, mapperVersion(platform)));
          result.rowsInserted += 1;
          continue;
        }

        if (existing.contentHash === freshHash) {
          result.rowsUnchanged += 1;
          continue;
        }

        await appSequelize.transaction(async (t) => {
          if (looksLikeIdentitySwap(existing, review)) {
            await IdentityAnomaly.create(
              {
                canonicalReviewId,
                platform,
                previousContentHash: existing.contentHash,
                newContentHash: freshHash,
              },
              { transaction: t },
            );
            result.identityAnomaliesDetected += 1;
          }

          await existing.update(buildRow(review, freshHash, mapperVersion(platform)), { transaction: t });
        });

        result.rowsUpdated += 1;
      }

      logger.info(
        {
          jobId,
          platform,
          track: "B",
          sourceAfterId: afterId,
          rowsScanned: result.rowsScanned,
          rowsInserted: result.rowsInserted,
          rowsUpdated: result.rowsUpdated,
          rowsUnchanged: result.rowsUnchanged,
          rowsRejected: result.rowsRejected,
          identityAnomalies: result.identityAnomaliesDetected,
          durationMs: Date.now() - batchStartedAt,
          status: "success",
        },
        "Track B batch complete",
      );

      if (rawRows.length < batchSize) break;
    }

    await recordReconciliationRun(platform, result.rowsScanned, result.rowsUpdated + result.rowsInserted);
  } catch (err) {
    result.status = "failed";
    result.durationMs = Date.now() - startedAt;
    logger.error(
      { jobId, platform, track: "B", status: "failed", durationMs: result.durationMs, error: (err as Error).message },
      "Track B run failed",
    );
    throw err;
  }

  result.durationMs = Date.now() - startedAt;
  logger.info(
    {
      jobId,
      platform,
      track: "B",
      windowStart,
      rowsScanned: result.rowsScanned,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsUnchanged: result.rowsUnchanged,
      rowsRejected: result.rowsRejected,
      identityAnomalies: result.identityAnomaliesDetected,
      durationMs: result.durationMs,
      status: result.status,
    },
    "Track B run complete",
  );

  return result;
}

function buildRow(review: UnifiedReview, contentHash: string, mapperVer: number) {
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
    contentHash,
    sourceUpdatedAt: review.sourceUpdatedAt,
    sourceExtra: review.sourceExtra,
    mapperVersion: mapperVer,
  };
}
