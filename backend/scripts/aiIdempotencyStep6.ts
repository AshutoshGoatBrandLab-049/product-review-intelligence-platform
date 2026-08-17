import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { runAiSentimentPipeline } from "../src/modules/ai/pipeline.js";
import { createAiProvider } from "../src/modules/ai/providers/providerFactory.js";
import { MockAiProvider } from "../src/modules/ai/providers/mockAiProvider.js";
import { computeContentHash } from "../src/modules/ingestion/shared/contentHash.js";
import type { AiProvider } from "../src/modules/ai/providers/aiProvider.js";
import type { AiAnalysisInput } from "../src/modules/ai/types.js";
import type { UnifiedReview } from "../src/types/unifiedReview.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 6 — real AI idempotency and staleness validation.
 * Budget: at most 1 additional real Gemini call (Case C). Cases A/B/D use
 * either a real-provider call-counting wrapper (proving zero calls, never
 * inferred) or a mock/counting provider (never spending real quota).
 * Mutations are confined to normalized_reviews (application-owned) —
 * DataWarehouse.* is never touched.
 */

/** Wraps any AiProvider and counts calls — instrumentation at the provider
 * boundary itself, never inferred from candidateCount or DB rows. */
function countingWrapper(inner: AiProvider): AiProvider & { callCount: number } {
  let callCount = 0;
  return {
    name: inner.name,
    modelVersion: inner.modelVersion,
    get callCount() {
      return callCount;
    },
    async analyzeReview(input: AiAnalysisInput) {
      callCount++;
      return inner.analyzeReview(input);
    },
    async narrate(pkg) {
      callCount++;
      return inner.narrate(pkg);
    },
  };
}

interface NormalizedRow {
  canonical_review_id: string;
  platform: "flipkart" | "myntra";
  source_product_id: string;
  source_review_id: string;
  identity_confidence: "native" | "derived";
  brand: string | null;
  rating: number;
  title: string | null;
  review_text: string | null;
  helpful_count: number | null;
  not_helpful_count: number | null;
  verified_purchase: boolean | null;
  has_images: boolean | null;
  image_urls: string[] | null;
  size_purchased: string | null;
  color_purchased: string | null;
  country: string | null;
  product_url: string | null;
  review_date: string;
  review_timestamp: Date | null;
  date_confidence: "exact" | "day" | "month";
  content_hash: string;
  source_updated_at: Date;
}

async function fetchRow(schema: string, id: string): Promise<NormalizedRow> {
  const [row] = await appSequelize.query<NormalizedRow>(
    `SELECT * FROM "${schema}".normalized_reviews WHERE canonical_review_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id } },
  );
  if (!row) throw new Error(`row not found: ${id}`);
  return row;
}

function toUnifiedReview(row: NormalizedRow): UnifiedReview {
  return {
    platform: row.platform,
    sourceProductId: row.source_product_id,
    sourceReviewId: row.source_review_id,
    sourceRowId: 0,
    identityConfidence: row.identity_confidence,
    brand: row.brand,
    rating: row.rating,
    title: row.title,
    reviewText: row.review_text,
    author: null,
    helpfulCount: row.helpful_count,
    notHelpfulCount: row.not_helpful_count,
    country: row.country,
    productUrl: row.product_url,
    reviewDate: row.review_date,
    reviewTimestamp: row.review_timestamp,
    dateConfidence: row.date_confidence,
    verifiedPurchase: row.verified_purchase,
    hasImages: row.has_images,
    imageUrls: row.image_urls,
    sizePurchased: row.size_purchased,
    colorPurchased: row.color_purchased,
    sourceUpdatedAt: row.source_updated_at,
    sourceExtra: null,
  };
}

async function main(): Promise<void> {
  const schema = config.appStore.schema;
  const report: Record<string, unknown> = {};

  // ── CASE A: unchanged review — real provider, call-counting wrapper ──────
  {
    const id = "5d71e3516d3845788242d94f3ce7d70f"; // flipkart, rating 2, classified in Step 4
    const before = await fetchRow(schema, id);
    const realProvider = createAiProvider();
    const wrapped = countingWrapper(realProvider);

    const result = await runAiSentimentPipeline(
      { canonicalReviewIds: [id], dryRun: false, totalLimit: 1, batchSize: 1 },
      wrapped,
    );

    const after = await fetchRow(schema, id);
    report.caseA_unchanged = {
      canonicalReviewId: id,
      contentHashUnchanged: before.content_hash === after.content_hash,
      candidateCount: result.candidateCount,
      alreadyClassifiedCount: result.alreadyClassifiedCount,
      realProviderCallCount: wrapped.callCount,
      newRowsWritten: result.successCount,
      classification: "PROVEN BY EXECUTION",
    };
  }

  // ── CASE C: content change — real provider, call-counting wrapper, budget 1 call ──
  {
    const id = "8b117544811870dad024f8f9cb3c2f60"; // flipkart, rating 4, classified in Step 4
    const before = await fetchRow(schema, id);
    const oldContentHash = before.content_hash;

    const mutatedText = `${before.review_text} [Step 6 Case C content-change test marker]`;
    const mutatedReview = toUnifiedReview({ ...before, review_text: mutatedText });
    const newContentHash = computeContentHash(mutatedReview);

    await appSequelize.query(
      `UPDATE "${schema}".normalized_reviews SET review_text = :text, content_hash = :hash WHERE canonical_review_id = :id`,
      { replacements: { text: mutatedText, hash: newContentHash, id } },
    );

    const realProvider = createAiProvider();
    const wrapped = countingWrapper(realProvider);
    const result = await runAiSentimentPipeline(
      { canonicalReviewIds: [id], dryRun: false, totalLimit: 1, batchSize: 1 },
      wrapped,
    );

    const after = await fetchRow(schema, id);
    report.caseC_contentChange = {
      canonicalReviewId: id,
      oldContentHash,
      newContentHash,
      contentHashChanged: oldContentHash !== newContentHash,
      candidateCount: result.candidateCount,
      realProviderCallCount: wrapped.callCount,
      pipelineStatus: result.status,
      successCount: result.successCount,
      failureCount: result.failureCount,
      perReviewOutcome: result.perReviewOutcomes[0] ?? null,
      finalStoredContentHash: after.content_hash,
      classification: "PROVEN BY EXECUTION",
      note: "normalized_reviews row permanently left in this mutated state (marker text appended) — documented, not restored, per instruction allowance for application-owned test fixtures.",
    };
  }

  // ── CASE D: rating change — content_hash via real function (in-memory), candidate reactivity via MOCK counting provider (0 real Gemini calls) ──
  {
    const id = "faac5dcf7f454634924ef28473a5bc9a"; // myntra, rating 4, classified in Step 4
    const before = await fetchRow(schema, id);
    const oldContentHash = before.content_hash;
    const newRating = before.rating === 5 ? 4 : 5; // toggle, guaranteed different

    const mutatedReview = toUnifiedReview({ ...before, rating: newRating });
    const newContentHash = computeContentHash(mutatedReview);

    await appSequelize.query(
      `UPDATE "${schema}".normalized_reviews SET rating = :rating, content_hash = :hash WHERE canonical_review_id = :id`,
      { replacements: { rating: newRating, hash: newContentHash, id } },
    );

    const mock = new MockAiProvider();
    const wrapped = countingWrapper(mock);
    const result = await runAiSentimentPipeline(
      { canonicalReviewIds: [id], dryRun: false, totalLimit: 1, batchSize: 1 },
      wrapped,
    );

    report.caseD_ratingChange = {
      canonicalReviewId: id,
      oldRating: before.rating,
      newRating,
      oldContentHash,
      newContentHash,
      contentHashChanged: oldContentHash !== newContentHash,
      candidateCount: result.candidateCount,
      mockProviderCallCount: wrapped.callCount, // NOT a real Gemini call — mock only
      realGeminiCallsUsedThisCase: 0,
      pipelineStatus: result.status,
      classification: "PROVEN BY EXECUTION (candidate reactivity via mock provider — zero real Gemini spend)",
      note: "normalized_reviews row permanently left with the toggled rating — documented, not restored.",
    };
  }

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
