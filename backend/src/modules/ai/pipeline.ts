import { randomUUID } from "node:crypto";
import pRetry from "p-retry";
import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { logger } from "../../shared/logger.js";
import { findCandidateReviews, summarizeCandidates, type CandidateReview, type CandidateFilter } from "./candidateSelection.js";
import { validateAiOutput, isFreshEnoughToWrite } from "./validation.js";
import { ReviewSentiment } from "../../database/appStore/models/reviewSentiment.js";
import { AiProcessingRun, type AiRunStatus } from "../../database/appStore/models/aiProcessingRun.js";
import { AiProviderError, type AiFailureCategory, type AiProvider } from "./providers/aiProvider.js";
import type { Platform } from "../../types/unifiedReview.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PipelineOptions {
  platform?: Platform;
  /** Phase 4.1 §4 — scopes the run to an explicit, pre-curated set of
   * canonical_review_ids (e.g. a controlled smoke-test sample). When set,
   * only these IDs are ever considered as candidates — everything else
   * (staleness, validation, retry, persistence, observability) is unchanged. */
  canonicalReviewIds?: string[];
  dryRun: boolean;
  batchSize?: number;
  /** Caps the total number of candidates processed across all batches this
   * run — distinct from batchSize (per-DB-fetch granularity). Used for
   * controlled small-subset validation (Phase 4 §23) before a full run. */
  totalLimit?: number;
  maxRetries?: number;
  jobId?: string;
}

export interface PerReviewOutcome {
  canonicalReviewId: string;
  platform: Platform;
  rating: number;
  outcome: "success" | "failure";
  latencyMs: number;
  retries: number;
  /** Phase 4.1 remediation item 3 — set only when outcome is "failure". */
  failureCategory?: AiFailureCategory;
  sentimentLabel?: string;
  sentimentConfidence?: number;
  themes?: Array<{ theme: string; confidence: number }>;
}

export interface PipelineResult {
  jobId: string;
  status: AiRunStatus;
  dryRun: boolean;
  provider: string;
  modelVersion: string;
  totalReviews: number;
  candidateCount: number;
  alreadyClassifiedCount: number;
  staleCount: number;
  newCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  durationMs: number;
  /** Per-review detail, for controlled smoke-test reporting (Phase 4.1 §4). Empty on dry-run. */
  perReviewOutcomes: PerReviewOutcome[];
}

/**
 * Writes one review's classification atomically: the sentiment row and its
 * theme rows either both land or neither does. Themes are fully replaced
 * (delete-then-insert) rather than diffed — matches this project's existing
 * "recompute from current state" philosophy (Track B's content_hash
 * reconciliation, Phase 3's full-rebuild aggregation) rather than
 * incremental patching.
 */
async function persistClassification(candidate: CandidateReview, output: import("./types.js").AiAnalysisOutput, modelVersion: string): Promise<void> {
  const schema = config.appStore.schema;

  await appSequelize.transaction(async (t) => {
    // Freshness guard (Phase 4 §7/§14): refuse to write a classification of
    // content that has since changed, even within this same pipeline run.
    const [currentRow] = await appSequelize.query<{ content_hash: string }>(
      `SELECT content_hash FROM "${schema}".normalized_reviews WHERE canonical_review_id = :id`,
      { type: QueryTypes.SELECT, replacements: { id: candidate.canonicalReviewId }, transaction: t },
    );
    if (!currentRow || !isFreshEnoughToWrite({ currentContentHash: currentRow.content_hash, hashBeingWritten: candidate.contentHash })) {
      throw new StaleWriteError(candidate.canonicalReviewId);
    }

    await ReviewSentiment.upsert(
      {
        canonicalReviewId: candidate.canonicalReviewId,
        label: output.sentiment.label,
        confidence: output.sentiment.confidence,
        modelVersion,
        classifiedAt: new Date(),
        contentHashAtClassification: candidate.contentHash,
      },
      { transaction: t },
    );

    await appSequelize.query(
      `DELETE FROM "${schema}".review_theme WHERE canonical_review_id = :id`,
      { replacements: { id: candidate.canonicalReviewId }, transaction: t },
    );

    for (const theme of output.themes) {
      await appSequelize.query(
        `INSERT INTO "${schema}".review_theme
           (canonical_review_id, theme, evidence_snippet, confidence, model_version, extracted_at, content_hash_at_extraction)
         VALUES (:id, :theme, :evidence, :confidence, :modelVersion, now(), :contentHash)`,
        {
          replacements: {
            id: candidate.canonicalReviewId,
            theme: theme.theme,
            evidence: theme.evidence,
            confidence: theme.confidence,
            modelVersion,
            contentHash: candidate.contentHash,
          },
          transaction: t,
        },
      );
    }
  });
}

export class StaleWriteError extends Error {
  constructor(canonicalReviewId: string) {
    super(`Refusing to write classification for ${canonicalReviewId}: content changed since candidate selection.`);
    this.name = "StaleWriteError";
  }
}

/**
 * Phase 4 §5/§8/§9/§10 — the AI batch pipeline. Dry-run makes zero AI calls
 * and zero database writes (not even the audit row). A real run processes
 * candidates in bounded batches, retries transient provider failures with
 * exponential backoff (via p-retry, already a project dependency, never used
 * until now), and isolates each review's failure from the rest of the batch
 * — one bad review never aborts the run. AI failures never touch
 * normalized_reviews (Phase 4 §13) — this pipeline has no write path to that
 * table at all.
 */
export async function runAiSentimentPipeline(options: PipelineOptions, provider: AiProvider): Promise<PipelineResult> {
  const startedAt = Date.now();
  const jobId = options.jobId ?? randomUUID();
  const batchSize = options.batchSize ?? config.ai.batchSize;
  const maxRetries = options.maxRetries ?? config.ai.maxRetries;
  const filter: CandidateFilter = { platform: options.platform, canonicalReviewIds: options.canonicalReviewIds };

  const summary = await summarizeCandidates(filter);

  if (options.dryRun) {
    const durationMs = Date.now() - startedAt;
    logger.info(
      {
        jobId,
        status: "success",
        dryRun: true,
        provider: provider.name,
        candidateCount: summary.candidateCount,
        alreadyClassifiedCount: summary.alreadyClassifiedCount,
        staleCount: summary.staleCount,
        newCount: summary.newCount,
        durationMs,
      },
      "AI sentiment pipeline dry-run complete — zero AI calls, zero writes",
    );
    return {
      jobId,
      status: "success",
      dryRun: true,
      provider: provider.name,
      modelVersion: provider.modelVersion,
      totalReviews: summary.totalReviews,
      candidateCount: summary.candidateCount,
      alreadyClassifiedCount: summary.alreadyClassifiedCount,
      staleCount: summary.staleCount,
      newCount: summary.newCount,
      processedCount: 0,
      successCount: 0,
      failureCount: 0,
      retryCount: 0,
      durationMs,
      perReviewOutcomes: [],
    };
  }

  const run = await AiProcessingRun.create({
    jobId,
    platform: options.platform ?? null,
    provider: provider.name,
    modelVersion: provider.modelVersion,
    dryRun: false,
    candidateCount: summary.candidateCount,
    alreadyClassifiedCount: summary.alreadyClassifiedCount,
    staleCount: summary.staleCount,
    newCount: summary.newCount,
    status: "running",
  });

  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let retryCount = 0;
  const perReviewOutcomes: PerReviewOutcome[] = [];

  try {
    let cursor = "";
    for (;;) {
      if (options.totalLimit !== undefined && processedCount >= options.totalLimit) break;

      const fetchSize =
        options.totalLimit !== undefined ? Math.min(batchSize, options.totalLimit - processedCount) : batchSize;

      // Never load the whole candidate set into memory — one bounded batch
      // at a time, same philosophy as Track A/B's batched pagination.
      // Keyset cursor (not OFFSET) — see candidateSelection.ts for why.
      const batch = await findCandidateReviews(filter, fetchSize, cursor);
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.canonicalReviewId;

      for (const candidate of batch) {
        processedCount++;
        const reviewStartedAt = Date.now();
        let retriesForThisReview = 0;
        try {
          const rawOutput = await pRetry(() => provider.analyzeReview(candidate), {
            retries: maxRetries,
            minTimeout: config.ai.retryMinTimeoutMs,
            // Phase 4.1 remediation item 2 — non-retryable failures (e.g. auth,
            // bad request) abort this review's attempts immediately rather than
            // burning through retries that cannot possibly succeed.
            shouldRetry: (error) => !(error instanceof AiProviderError) || error.retryable !== false,
            onFailedAttempt: async (error) => {
              retryCount++;
              retriesForThisReview++;
              const providerError = error instanceof AiProviderError ? error : undefined;
              const category = providerError?.category ?? "unknown";
              // Only wait the provider-suggested delay when this attempt will
              // actually be retried — no point pausing before a final, fatal failure.
              const willRetry = providerError?.retryable !== false;
              const suggestedMs = willRetry ? providerError?.retryAfterMs : undefined;
              if (suggestedMs !== undefined) {
                const cappedMs = Math.min(suggestedMs, config.ai.retryMaxDelayMs);
                logger.warn(
                  {
                    jobId,
                    platform: candidate.platform,
                    canonicalReviewId: candidate.canonicalReviewId,
                    attempt: error.attemptNumber,
                    retriesLeft: error.retriesLeft,
                    failureCategory: category,
                    providerSuggestedDelayMs: suggestedMs,
                    actualWaitMs: cappedMs,
                  },
                  "AI provider call failed, waiting provider-suggested delay before retrying",
                );
                await sleep(cappedMs);
              } else {
                logger.warn(
                  {
                    jobId,
                    platform: candidate.platform,
                    canonicalReviewId: candidate.canonicalReviewId,
                    attempt: error.attemptNumber,
                    retriesLeft: error.retriesLeft,
                    failureCategory: category,
                  },
                  "AI provider call failed, retrying",
                );
              }
            },
          });
          const latencyMs = Date.now() - reviewStartedAt;

          const validation = validateAiOutput(rawOutput);
          if (!validation.valid) {
            failureCount++;
            logger.error(
              { jobId, platform: candidate.platform, canonicalReviewId: candidate.canonicalReviewId, failureCategory: "validation_error", errors: validation.errors },
              "AI output failed validation — skipped, no partial write",
            );
            perReviewOutcomes.push({
              canonicalReviewId: candidate.canonicalReviewId,
              platform: candidate.platform,
              rating: candidate.rating,
              outcome: "failure",
              latencyMs,
              retries: retriesForThisReview,
              failureCategory: "validation_error",
            });
            continue;
          }

          await persistClassification(candidate, validation.data, provider.modelVersion);
          successCount++;
          perReviewOutcomes.push({
            canonicalReviewId: candidate.canonicalReviewId,
            platform: candidate.platform,
            rating: candidate.rating,
            outcome: "success",
            latencyMs,
            retries: retriesForThisReview,
            sentimentLabel: validation.data.sentiment.label,
            sentimentConfidence: validation.data.sentiment.confidence,
            themes: validation.data.themes.map((t) => ({ theme: t.theme, confidence: t.confidence })),
          });
        } catch (err) {
          const latencyMs = Date.now() - reviewStartedAt;
          failureCount++;
          const failureCategory: AiFailureCategory =
            err instanceof AiProviderError ? err.category : err instanceof StaleWriteError ? "persistence_error" : "unknown";
          logger.error(
            { jobId, platform: candidate.platform, canonicalReviewId: candidate.canonicalReviewId, failureCategory, error: (err as Error).message },
            "AI processing failed for this review — batch continues",
          );
          perReviewOutcomes.push({
            canonicalReviewId: candidate.canonicalReviewId,
            platform: candidate.platform,
            rating: candidate.rating,
            outcome: "failure",
            latencyMs,
            retries: retriesForThisReview,
            failureCategory,
          });
        }
      }

      if (batch.length < fetchSize) break;
    }

    const status: AiRunStatus = failureCount === 0 ? "success" : successCount > 0 ? "partial_failure" : "failed";
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt;

    await run.update({
      processedCount,
      successCount,
      failureCount,
      retryCount,
      finishedAt,
      durationMs,
      status,
    });

    logger.info(
      { jobId, status, provider: provider.name, modelVersion: provider.modelVersion, processedCount, successCount, failureCount, retryCount, durationMs },
      "AI sentiment pipeline run complete",
    );

    return {
      jobId,
      status,
      dryRun: false,
      provider: provider.name,
      modelVersion: provider.modelVersion,
      totalReviews: summary.totalReviews,
      candidateCount: summary.candidateCount,
      alreadyClassifiedCount: summary.alreadyClassifiedCount,
      staleCount: summary.staleCount,
      newCount: summary.newCount,
      processedCount,
      successCount,
      failureCount,
      retryCount,
      durationMs,
      perReviewOutcomes,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    await run.update({ processedCount, successCount, failureCount, retryCount, finishedAt: new Date(), durationMs, status: "failed" });
    logger.error({ jobId, error: (err as Error).message, durationMs }, "AI sentiment pipeline run failed");
    throw err;
  }
}
