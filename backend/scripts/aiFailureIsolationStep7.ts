import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { runTrackA } from "../src/modules/ingestion/trackA.js";
import { runAiSentimentPipeline } from "../src/modules/ai/pipeline.js";
import { MockAiProvider } from "../src/modules/ai/providers/mockAiProvider.js";
import { AiProviderError, type AiProvider } from "../src/modules/ai/providers/aiProvider.js";
import type { AiAnalysisInput } from "../src/modules/ai/types.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 7 — failure isolation & retry validation. Runs entirely
 * against the isolated test fixture database (pri_test_appstore /
 * pri_test_prodsource — the SAME database the existing vitest suite already
 * uses), never the restored 100,006-row local dataset and never real Gemini.
 * Must be invoked with the test env vars set (see run-step7.sh / inline env
 * in the command that launches this script) so config resolves to the test
 * databases, exactly like tests/setupTestEnv.ts does for vitest.
 */

function countingWrapper(inner: AiProvider): AiProvider & { callCount: number; callsPerReview: Record<string, number> } {
  let callCount = 0;
  const callsPerReview: Record<string, number> = {};
  return {
    name: inner.name,
    modelVersion: inner.modelVersion,
    get callCount() {
      return callCount;
    },
    callsPerReview,
    async analyzeReview(input: AiAnalysisInput) {
      callCount++;
      callsPerReview[input.canonicalReviewId] = (callsPerReview[input.canonicalReviewId] ?? 0) + 1;
      return inner.analyzeReview(input);
    },
    async narrate(pkg) {
      callCount++;
      return inner.narrate(pkg);
    },
  };
}

/** Wraps MockAiProvider and unconditionally fails for one specific canonical_review_id, every attempt (proves retry exhaustion, not a one-shot injected failure). */
function failOnIdProvider(failId: string): AiProvider {
  const mock = new MockAiProvider();
  return {
    name: "mock-fail-on-id",
    modelVersion: mock.modelVersion,
    async analyzeReview(input: AiAnalysisInput) {
      if (input.canonicalReviewId === failId) {
        throw new AiProviderError("mock-fail-on-id", `injected deterministic failure for ${failId}`);
      }
      return mock.analyzeReview(input);
    },
    async narrate(pkg) {
      return mock.narrate(pkg);
    },
  };
}

async function resetFixture(): Promise<void> {
  const schema = config.appStore.schema;
  await appSequelize.query(
    `TRUNCATE TABLE "${schema}".normalized_reviews, "${schema}".identity_anomalies, ` +
      `"${schema}".ingestion_rejects, "${schema}".ingestion_watermarks, ` +
      `"${schema}".product_dimension, "${schema}".product_daily_metrics, ` +
      `"${schema}".review_sentiment, "${schema}".review_theme, ` +
      `"${schema}".ai_processing_runs CASCADE`,
  );
}

interface SentimentRow {
  canonical_review_id: string;
  label: string;
  confidence: number;
  content_hash_at_classification: string;
}
interface ThemeRow {
  canonical_review_id: string;
  theme: string;
  content_hash_at_extraction: string;
}

async function main(): Promise<void> {
  const schema = config.appStore.schema;
  const report: Record<string, unknown> = {
    databaseSafety: {
      appStoreDatabase: config.appStore.database,
      appStoreSchema: schema,
      prodReadOnlyDatabase: config.prodReadOnly.database,
      note: "Must read pri_test_appstore / pri_test_prodsource. If this shows gbl_data_lake, ABORT — wrong env.",
    },
  };

  if (config.appStore.database !== "pri_test_appstore") {
    throw new Error(
      `Refusing to run: config.appStore.database is "${config.appStore.database}", expected "pri_test_appstore". ` +
        `This script must never run against the real local dataset.`,
    );
  }

  // ── Fixture setup ─────────────────────────────────────────────────────
  await resetFixture();
  await runTrackA("flipkart");
  await runTrackA("myntra");

  const rows = await appSequelize.query<{ canonical_review_id: string }>(
    `SELECT canonical_review_id FROM "${schema}".normalized_reviews ORDER BY canonical_review_id ASC`,
    { type: QueryTypes.SELECT },
  );
  const ids = rows.map((r) => r.canonical_review_id);
  report.step7B_setup = { fixtureReviewCount: ids.length, canonicalReviewIdsSortedAsc: ids };

  if (ids.length < 5) throw new Error(`Fixture has only ${ids.length} reviews, need >= 5`);

  // Label A..F by sorted canonical_review_id order (matches actual candidate-selection order).
  const labels = ["A", "B", "C", "D", "E", "F"].slice(0, ids.length);
  const idToLabel: Record<string, string> = {};
  ids.forEach((id, i) => (idToLabel[id] = labels[i]!));
  const failId = ids[2]!; // "review C"

  // ── Step 7B: single failure inside a multi-review batch ────────────────
  const failProvider = failOnIdProvider(failId);
  const wrappedFail = countingWrapper(failProvider);
  const maxRetries = 2;

  const resultB = await runAiSentimentPipeline(
    { canonicalReviewIds: ids, dryRun: false, totalLimit: ids.length, batchSize: ids.length, maxRetries },
    wrappedFail,
  );

  report.step7B_result = {
    injectedFailureReviewId: failId,
    injectedFailureLabel: idToLabel[failId],
    maxRetriesConfigured: maxRetries,
    candidateCount: resultB.candidateCount,
    processedCount: resultB.processedCount,
    successCount: resultB.successCount,
    failureCount: resultB.failureCount,
    retryCount: resultB.retryCount,
    durationMs: resultB.durationMs,
    providerTotalCallCount: wrappedFail.callCount,
    providerCallsPerReview: Object.fromEntries(
      Object.entries(wrappedFail.callsPerReview).map(([id, n]) => [`${idToLabel[id]} (${id})`, n]),
    ),
    perReviewOutcomesInProcessingOrder: resultB.perReviewOutcomes.map((o) => ({
      label: idToLabel[o.canonicalReviewId],
      canonicalReviewId: o.canonicalReviewId,
      outcome: o.outcome,
      retries: o.retries,
      latencyMs: o.latencyMs,
    })),
  };

  // ── Step 7C: database validation (direct SQL, not pipeline counters) ───
  const sentimentRows = await appSequelize.query<SentimentRow>(
    `SELECT canonical_review_id, label, confidence, content_hash_at_classification FROM "${schema}".review_sentiment WHERE canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids } },
  );
  const themeRows = await appSequelize.query<ThemeRow>(
    `SELECT canonical_review_id, theme, content_hash_at_extraction FROM "${schema}".review_theme WHERE canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids } },
  );
  const normRows = await appSequelize.query<{ canonical_review_id: string; content_hash: string }>(
    `SELECT canonical_review_id, content_hash FROM "${schema}".normalized_reviews WHERE canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids } },
  );
  const hashById = Object.fromEntries(normRows.map((r) => [r.canonical_review_id, r.content_hash]));

  const sentimentCountById: Record<string, number> = {};
  for (const r of sentimentRows) sentimentCountById[r.canonical_review_id] = (sentimentCountById[r.canonical_review_id] ?? 0) + 1;

  report.step7C_databaseValidation = {
    sentimentRowsForBatch: sentimentRows.map((r) => ({
      label: idToLabel[r.canonical_review_id],
      canonicalReviewId: r.canonical_review_id,
      hashMatchesNormalized: r.content_hash_at_classification === hashById[r.canonical_review_id],
    })),
    themeRowsForBatch: themeRows.map((r) => ({
      label: idToLabel[r.canonical_review_id],
      canonicalReviewId: r.canonical_review_id,
      theme: r.theme,
      hashMatchesNormalized: r.content_hash_at_extraction === hashById[r.canonical_review_id],
    })),
    failedReviewHasNoSentimentRow: !sentimentRows.some((r) => r.canonical_review_id === failId),
    failedReviewHasNoThemeRows: !themeRows.some((r) => r.canonical_review_id === failId),
    duplicateSentimentRows: Object.entries(sentimentCountById).filter(([, n]) => n > 1),
    successfulReviewsWithExactlyOneSentimentRow: ids.filter((id) => id !== failId).every((id) => sentimentCountById[id] === 1),
  };

  // ── Step 7E: retry the failed review (failure removed, real pipeline, scoped only to it) ──
  const recoveredProvider = new MockAiProvider();
  const wrappedRecovered = countingWrapper(recoveredProvider);
  const resultE = await runAiSentimentPipeline(
    { canonicalReviewIds: [failId], dryRun: false, totalLimit: 1, batchSize: 1, maxRetries },
    wrappedRecovered,
  );
  const sentimentAfterRecovery = await appSequelize.query<SentimentRow>(
    `SELECT canonical_review_id, label, confidence, content_hash_at_classification FROM "${schema}".review_sentiment WHERE canonical_review_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: failId } },
  );
  const themesAfterRecovery = await appSequelize.query<ThemeRow>(
    `SELECT canonical_review_id, theme, content_hash_at_extraction FROM "${schema}".review_theme WHERE canonical_review_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: failId } },
  );

  report.step7E_retryRecovery = {
    canonicalReviewId: failId,
    candidateCount: resultE.candidateCount,
    providerCallCount: wrappedRecovered.callCount,
    successCount: resultE.successCount,
    sentimentRowCount: sentimentAfterRecovery.length,
    themeRowCount: themesAfterRecovery.length,
  };

  // ── Step 7F: idempotency after recovery — run again, unchanged ─────────
  const wrappedIdempotent = countingWrapper(new MockAiProvider());
  const sentimentBeforeF = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".review_sentiment`,
    { type: QueryTypes.SELECT },
  );
  const resultF = await runAiSentimentPipeline(
    { canonicalReviewIds: [failId], dryRun: false, totalLimit: 1, batchSize: 1, maxRetries },
    wrappedIdempotent,
  );
  const sentimentAfterF = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".review_sentiment`,
    { type: QueryTypes.SELECT },
  );

  report.step7F_idempotencyAfterRecovery = {
    candidateCount: resultF.candidateCount,
    providerCallCount: wrappedIdempotent.callCount,
    newWrites: resultF.successCount,
    sentimentCountBefore: Number(sentimentBeforeF[0]!.count),
    sentimentCountAfter: Number(sentimentAfterF[0]!.count),
    countUnchanged: sentimentBeforeF[0]!.count === sentimentAfterF[0]!.count,
  };

  console.log(JSON.stringify(report, null, 2));
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
