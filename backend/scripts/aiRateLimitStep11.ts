import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { runAiSentimentPipeline } from "../src/modules/ai/pipeline.js";
import { createAiProvider } from "../src/modules/ai/providers/providerFactory.js";
import type { AiProvider } from "../src/modules/ai/providers/aiProvider.js";
import type { AiAnalysisInput } from "../src/modules/ai/types.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 11 — deliberate, controlled real rate-limit reproduction.
 * The free tier's quota is 5 generate_content requests/minute (confirmed in
 * Step 4's real 429 payload). 6 previously-unclassified real local reviews,
 * processed sequentially through the real pipeline with the real
 * GeminiProvider, are enough to deterministically exceed that quota within
 * one rolling minute (Step 4 already showed 10 sequential real calls at
 * similar per-call latency triggers one). A timestamped call-counting
 * wrapper records exact call start/end times and latency — measured at the
 * provider boundary, never inferred. These are genuinely new, previously-
 * unclassified reviews (same precedent as Step 4): classification is a
 * legitimate, permanent addition, not a mutation requiring restoration —
 * normalized_reviews and its checksum are untouched by classification.
 */
const REVIEW_IDS = [
  "0001dd698211cc0ed8076248f3b89021",
  "00041e1300b5d366900d9f9ab200d47f",
  "0005331b413db04ff7f35bc92208653c",
  "00086f1f1a61480905c534ebc87e6e9b",
  "00089776b19736c42e7f22b51ead6ad9",
  "0009d57611f83fea0c5437b3eb773db5",
];

interface CallRecord {
  canonicalReviewId: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  outcome: "success" | "error";
  errorMessage?: string;
}

function timestampedWrapper(inner: AiProvider): AiProvider & { callCount: number; calls: CallRecord[] } {
  let callCount = 0;
  const calls: CallRecord[] = [];
  return {
    name: inner.name,
    modelVersion: inner.modelVersion,
    get callCount() {
      return callCount;
    },
    calls,
    async analyzeReview(input: AiAnalysisInput) {
      callCount++;
      const startedAtMs = Date.now();
      try {
        const result = await inner.analyzeReview(input);
        calls.push({ canonicalReviewId: input.canonicalReviewId, startedAtMs, finishedAtMs: Date.now(), durationMs: Date.now() - startedAtMs, outcome: "success" });
        return result;
      } catch (err) {
        calls.push({
          canonicalReviewId: input.canonicalReviewId,
          startedAtMs,
          finishedAtMs: Date.now(),
          durationMs: Date.now() - startedAtMs,
          outcome: "error",
          errorMessage: (err as Error).message,
        });
        throw err;
      }
    },
    async narrate(pkg) {
      callCount++;
      return inner.narrate(pkg);
    },
  };
}

async function main(): Promise<void> {
  const schema = config.appStore.schema;
  if (config.ai.provider !== "gemini") {
    throw new Error(`AI_PROVIDER is "${config.ai.provider}", expected "gemini" — refusing to run.`);
  }

  const before = await appSequelize.query<{ sentiment_count: string; theme_count: string; checksum: string }>(
    `SELECT
       (SELECT count(*)::text FROM "${schema}".review_sentiment) AS sentiment_count,
       (SELECT count(*)::text FROM "${schema}".review_theme) AS theme_count,
       (SELECT md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id)) FROM "${schema}".normalized_reviews) AS checksum`,
    { type: QueryTypes.SELECT },
  );

  const realProvider = createAiProvider();
  const wrapped = timestampedWrapper(realProvider);

  const runStartedAt = Date.now();
  const result = await runAiSentimentPipeline(
    { canonicalReviewIds: REVIEW_IDS, dryRun: false, totalLimit: REVIEW_IDS.length, batchSize: REVIEW_IDS.length },
    wrapped,
  );
  const runDurationMs = Date.now() - runStartedAt;

  const after = await appSequelize.query<{ sentiment_count: string; theme_count: string; checksum: string; normalized_count: string }>(
    `SELECT
       (SELECT count(*)::text FROM "${schema}".review_sentiment) AS sentiment_count,
       (SELECT count(*)::text FROM "${schema}".review_theme) AS theme_count,
       (SELECT count(*)::text FROM "${schema}".normalized_reviews) AS normalized_count,
       (SELECT md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id)) FROM "${schema}".normalized_reviews) AS checksum`,
    { type: QueryTypes.SELECT },
  );

  const partialWriteCheck = await appSequelize.query<{ canonical_review_id: string; has_sentiment: boolean }>(
    `SELECT nr.canonical_review_id, (rs.canonical_review_id IS NOT NULL) AS has_sentiment
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = nr.canonical_review_id
     WHERE nr.canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids: REVIEW_IDS } },
  );

  console.log(
    JSON.stringify(
      {
        provider: { name: wrapped.name, modelVersion: wrapped.modelVersion },
        runDurationMs,
        totalProviderCallCount: wrapped.callCount,
        candidateCount: result.candidateCount,
        processedCount: result.processedCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        retryCount: result.retryCount,
        status: result.status,
        perCallRecords: wrapped.calls.map((c) => ({
          canonicalReviewId: c.canonicalReviewId,
          startedAtMs: c.startedAtMs - runStartedAt,
          durationMs: c.durationMs,
          outcome: c.outcome,
          errorMessage: c.errorMessage,
        })),
        perReviewOutcomes: result.perReviewOutcomes.map((o) => ({
          canonicalReviewId: o.canonicalReviewId,
          outcome: o.outcome,
          retries: o.retries,
          latencyMs: o.latencyMs,
        })),
        databaseBefore: before[0],
        databaseAfter: after[0],
        checksumUnchanged: before[0]!.checksum === after[0]!.checksum,
        partialWriteCheck: partialWriteCheck.map((r) => ({ canonicalReviewId: r.canonical_review_id, hasSentiment: r.has_sentiment })),
      },
      null,
      2,
    ),
  );
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => appSequelize.close())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
