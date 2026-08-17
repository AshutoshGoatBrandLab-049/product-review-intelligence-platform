import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { MockAiProvider } from "../src/modules/ai/providers/mockAiProvider.js";
import { validateAiOutput } from "../src/modules/ai/validation.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 5 — mock vs real comparison, read-only with respect to
 * review_sentiment/review_theme. The mock provider is called fresh
 * (in-process, no persistence — analyzeReview() only, never through the
 * pipeline's persist step, which would overwrite Step 4's real Gemini
 * results via upsert). The Gemini side reuses Step 4's already-persisted
 * results — zero additional real API calls.
 */
const SELECTED_CANONICAL_REVIEW_IDS = [
  "d07762e22dd3d7968944a67ed8f8e97f",
  "5d71e3516d3845788242d94f3ce7d70f",
  "1da85552aeba28e8196bbaf0d78e72ba",
  "8b117544811870dad024f8f9cb3c2f60",
  "d3210af1a39bc198b54e43b653f1e595",
  "d138a2df0f1868ea46237eaeaf474b05",
  "b7815b09a9183b90ec18b9912a998b6a",
  "3a351bb03a322a5bae16b901347896e8",
  "faac5dcf7f454634924ef28473a5bc9a",
  "00671e22a100c432e6a944e812fc87d8",
];

interface ReviewRow {
  canonical_review_id: string;
  platform: string;
  rating: number;
  title: string | null;
  review_text: string | null;
}

async function main(): Promise<void> {
  const schema = config.appStore.schema;

  const reviews = await appSequelize.query<ReviewRow>(
    `SELECT canonical_review_id, platform, rating, title, review_text
     FROM "${schema}".normalized_reviews
     WHERE canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids: SELECTED_CANONICAL_REVIEW_IDS } },
  );

  const existingSentiment = await appSequelize.query<{
    canonical_review_id: string;
    label: string;
    confidence: number;
    model_version: string;
  }>(
    `SELECT canonical_review_id, label, confidence, model_version FROM "${schema}".review_sentiment WHERE canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids: SELECTED_CANONICAL_REVIEW_IDS } },
  );
  const existingThemes = await appSequelize.query<{ canonical_review_id: string; theme: string; confidence: number }>(
    `SELECT canonical_review_id, theme, confidence FROM "${schema}".review_theme WHERE canonical_review_id IN (:ids)`,
    { type: QueryTypes.SELECT, replacements: { ids: SELECTED_CANONICAL_REVIEW_IDS } },
  );

  const mock = new MockAiProvider();
  const comparisons = [];

  for (const id of SELECTED_CANONICAL_REVIEW_IDS) {
    const review = reviews.find((r) => r.canonical_review_id === id);
    if (!review) {
      comparisons.push({ canonicalReviewId: id, error: "review not found in normalized_reviews" });
      continue;
    }

    const mockRaw = await mock.analyzeReview({
      canonicalReviewId: id,
      rating: review.rating,
      title: review.title,
      reviewText: review.review_text,
    });
    const mockValidation = validateAiOutput(mockRaw);

    const geminiSentiment = existingSentiment.find((s) => s.canonical_review_id === id);
    const geminiThemes = existingThemes.filter((t) => t.canonical_review_id === id);

    comparisons.push({
      canonicalReviewId: id,
      platform: review.platform,
      rating: review.rating,
      mock: {
        valid: mockValidation.valid,
        sentiment: mockValidation.valid ? mockValidation.data.sentiment : null,
        themes: mockValidation.valid ? mockValidation.data.themes.map((t) => ({ theme: t.theme, confidence: t.confidence })) : [],
      },
      gemini: geminiSentiment
        ? {
            available: true,
            sentiment: { label: geminiSentiment.label, confidence: geminiSentiment.confidence },
            themes: geminiThemes.map((t) => ({ theme: t.theme, confidence: t.confidence })),
          }
        : { available: false, reason: "no persisted result — Step 4 rate-limit failure for this review" },
    });
  }

  console.log(JSON.stringify(comparisons, null, 2));

  // No writes were made — confirm counts unchanged.
  const [after] = await appSequelize.query<{ sentiment_count: string; theme_count: string }>(
    `SELECT (SELECT count(*)::text FROM "${schema}".review_sentiment) AS sentiment_count,
            (SELECT count(*)::text FROM "${schema}".review_theme) AS theme_count`,
    { type: QueryTypes.SELECT },
  );
  console.log("After counts (should be unchanged from before):", after);
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
