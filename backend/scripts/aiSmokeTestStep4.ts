import { runAiSentimentPipeline } from "../src/modules/ai/pipeline.js";
import { createAiProvider } from "../src/modules/ai/providers/providerFactory.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 4 — the 10-review LOCAL smoke test. Runs the REAL,
 * unmodified pipeline (candidate selection, staleness, Zod validation,
 * theme-vocabulary validation, persistence, retry, observability — nothing
 * bypassed) scoped to exactly these 10 pre-selected, already-existing
 * normalized_reviews via the new canonicalReviewIds filter. Uses the real
 * provider through the normal factory (AI_PROVIDER=gemini from .env).
 */
const SELECTED_CANONICAL_REVIEW_IDS = [
  "d07762e22dd3d7968944a67ed8f8e97f", // flipkart, rating 1
  "5d71e3516d3845788242d94f3ce7d70f", // flipkart, rating 2
  "1da85552aeba28e8196bbaf0d78e72ba", // flipkart, rating 3
  "8b117544811870dad024f8f9cb3c2f60", // flipkart, rating 4
  "d3210af1a39bc198b54e43b653f1e595", // flipkart, rating 5
  "d138a2df0f1868ea46237eaeaf474b05", // myntra, rating 1
  "b7815b09a9183b90ec18b9912a998b6a", // myntra, rating 2
  "3a351bb03a322a5bae16b901347896e8", // myntra, rating 3
  "faac5dcf7f454634924ef28473a5bc9a", // myntra, rating 4
  "00671e22a100c432e6a944e812fc87d8", // myntra, rating 5
];

async function main(): Promise<void> {
  const provider = createAiProvider();
  console.log(`Provider: ${provider.name}, model: ${provider.modelVersion}`);
  console.log(`Processing exactly ${SELECTED_CANONICAL_REVIEW_IDS.length} pre-selected reviews.`);

  const result = await runAiSentimentPipeline(
    {
      canonicalReviewIds: SELECTED_CANONICAL_REVIEW_IDS,
      dryRun: false,
      totalLimit: SELECTED_CANONICAL_REVIEW_IDS.length,
      batchSize: SELECTED_CANONICAL_REVIEW_IDS.length,
    },
    provider,
  );

  console.log(JSON.stringify(result, null, 2));
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
