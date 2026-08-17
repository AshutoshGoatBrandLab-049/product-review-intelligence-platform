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

      await appSequelize.transaction(async (t) => {
        if (toInsert.length > 0) {
          await NormalizedReview.bulkCreate(toInsert, {
            transaction: t,
            ignoreDuplicates: true, // harmless overlap with Track B — ON CONFLICT DO NOTHING
          });
        }
        await advanceLastSeenSourceId(platform, maxIdInBatch, t);
      });

      result.rowsInserted += toInsert.length;
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
          rowsInserted: toInsert.length,
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

  result.durationMs = Date.now() - startedAt;
  logger.info(
    {
      jobId,
      platform,
      track: "A",
      sourceRange: `${sourceAfterIdStart}-${result.finalLastSeenSourceId}`,
      batchesProcessed: result.batchesProcessed,
      rowsRead: result.rowsRead,
      rowsInserted: result.rowsInserted,
      rowsRejected: result.rowsRejected,
      durationMs: result.durationMs,
      status: result.status,
    },
    "Track A run complete",
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
