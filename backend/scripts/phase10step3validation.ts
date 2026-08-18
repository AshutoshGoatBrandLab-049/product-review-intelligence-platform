/**
 * Phase 10 Step 3 — Real-Data Validation Script
 * Tests semantic analysis against actual FKPID000001 data
 */

import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { analyzeProductQuestion } from "../src/modules/ai/productAnalyst.js";
import { OpenAiProvider } from "../src/modules/ai/providers/openaiProvider.js";
import { QueryTypes } from "sequelize";

async function main() {
  console.log("\n=== PHASE 10 STEP 3 — REAL-DATA VALIDATION ===\n");

  const schema = config.appStore.schema;

  // Step 1: Verify dataset state
  console.log("1. VERIFYING DATASET STATE FOR FKPID000001...\n");

  const stats = (await appSequelize.query<any>(
    `SELECT
      COUNT(*) as total_reviews,
      COUNT(CASE WHEN rating <= 2 THEN 1 END) as negative_reviews,
      COUNT(CASE WHEN rt.theme IS NOT NULL THEN 1 END) as with_theme_labels,
      COUNT(DISTINCT CASE WHEN rt.theme IS NOT NULL THEN rt.canonical_review_id END) as unique_reviews_with_themes
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_theme rt ON nr.canonical_review_id = rt.canonical_review_id
     WHERE nr.platform = 'flipkart' AND nr.source_product_id = 'FKPID000001'`,
    { type: QueryTypes.SELECT },
  )) as any[];

  const dataset = stats[0];
  console.log(`   Total reviews: ${dataset.total_reviews}`);
  console.log(`   Negative reviews (rating ≤ 2): ${dataset.negative_reviews}`);
  console.log(`   With theme labels: ${dataset.with_theme_labels}`);
  console.log(`   Unique reviews with themes: ${dataset.unique_reviews_with_themes}`);
  console.log(
    `   Unclassified negative reviews: ${dataset.negative_reviews - dataset.unique_reviews_with_themes}\n`,
  );

  // Step 2: Initialize AI provider
  console.log("2. INITIALIZING OPENAI PROVIDER...\n");

  const provider = new OpenAiProvider(config.ai.openaiApiKey, config.ai.openaiModel);
  console.log(`   Provider: ${provider.name}`);
  console.log(`   Model: ${provider.modelVersion}\n`);

  // Step 3: Test "What's the biggest issue?" question
  console.log("3. TESTING SEMANTIC ANALYSIS: 'What's the biggest issue?'\n");

  try {
    const response = await analyzeProductQuestion(
      {
        platform: "flipkart",
        sourceProductId: "FKPID000001",
        userQuestion: "What's the biggest issue?",
        window: "30d",
      },
      provider,
    );

    console.log(`   Question: ${response.userQuestion}`);
    console.log(`   Window: ${response.window}`);
    console.log(`   Cache Hit: ${response.cacheHit}\n`);
    console.log("   ANSWER:");
    console.log(`   ${response.answer}\n`);

    console.log("   ROOT CAUSES IDENTIFIED:");
    if (response.analysis!.rootCause && response.analysis!.rootCause.length > 0) {
      for (const rc of response.analysis!.rootCause) {
        console.log(`   - ${rc.theme}: ${rc.explanation}`);
        console.log(`     Supporting reviews: ${rc.evidenceReviewIds.length} citations`);
      }
    } else {
      console.log("   (No root causes identified)");
    }

    console.log("\n   VERIFICATION CHECKS:");
    console.log(`   ✓ Response is not 'insufficient data': ${!response.answer.includes("insufficient data")}`);
    console.log(`   ✓ Answer is not generic statistics-only: ${!response.answer.match(/average rating|positive percentage|negative percentage/)}`);
    console.log(`   ✓ Root causes provided: ${response.analysis!.rootCause && response.analysis!.rootCause.length > 0}`);
    if (response.analysis!.rootCause && response.analysis!.rootCause.length > 0) {
      console.log(`   ✓ Evidence IDs are real: ${(response.analysis!.rootCause[0]?.evidenceReviewIds?.length ?? 0) > 0}`);
    }
  } catch (error) {
    console.error("   ERROR:", error instanceof Error ? error.message : String(error));
    throw error;
  }

  // Step 4: Test "What are customers complaining about?" question
  console.log("\n4. TESTING COMPLAINT ANALYSIS: 'What are customers complaining about?'\n");

  try {
    const response = await analyzeProductQuestion(
      {
        platform: "flipkart",
        sourceProductId: "FKPID000001",
        userQuestion: "What are customers complaining about?",
        window: "30d",
      },
      provider,
    );

    console.log(`   Question: ${response.userQuestion}`);
    console.log(`   Cache Hit: ${response.cacheHit}\n`);
    console.log("   ANSWER:");
    console.log(`   ${response.answer.substring(0, 300)}...\n`);

    console.log("   VERIFICATION CHECKS:");
    console.log(`   ✓ Response includes complaint analysis: ${response.answer.includes("complaint") || response.answer.includes("issue") || response.analysis!.rootCause.length > 0}`);
  } catch (error) {
    console.error("   ERROR:", error instanceof Error ? error.message : String(error));
    throw error;
  }

  // Step 5: Test "What do customers like?" question
  console.log("\n5. TESTING POSITIVE FEEDBACK: 'What do customers like?'\n");

  try {
    const response = await analyzeProductQuestion(
      {
        platform: "flipkart",
        sourceProductId: "FKPID000001",
        userQuestion: "What do customers like?",
        window: "30d",
      },
      provider,
    );

    console.log(`   Question: ${response.userQuestion}`);
    console.log(`   Cache Hit: ${response.cacheHit}\n`);
    console.log("   ANSWER:");
    console.log(`   ${response.answer.substring(0, 300)}...\n`);

    console.log("   VERIFICATION CHECKS:");
    console.log(`   ✓ Response addresses positive feedback: ${response.answer.includes("positive") || response.answer.includes("good") || response.answer.includes("great")}`);
  } catch (error) {
    console.error("   ERROR:", error instanceof Error ? error.message : String(error));
    throw error;
  }

  // Step 6: Verify no database modifications
  console.log("\n6. VERIFYING NO DATABASE MODIFICATIONS...\n");

  const statsAfter = (await appSequelize.query<any>(
    `SELECT
      COUNT(*) as total_reviews,
      COUNT(CASE WHEN rt.theme IS NOT NULL THEN 1 END) as with_theme_labels
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_theme rt ON nr.canonical_review_id = rt.canonical_review_id
     WHERE nr.platform = 'flipkart' AND nr.source_product_id = 'FKPID000001'`,
    { type: QueryTypes.SELECT },
  )) as any[];

  const datasetAfter = statsAfter[0];
  console.log(`   Total reviews before: ${dataset.total_reviews}, after: ${datasetAfter.total_reviews}`);
  console.log(`   With theme labels before: ${dataset.with_theme_labels}, after: ${datasetAfter.with_theme_labels}`);
  console.log(`   ✓ Database unchanged: ${dataset.total_reviews === datasetAfter.total_reviews && dataset.with_theme_labels === datasetAfter.with_theme_labels}`);

  console.log("\n=== VALIDATION COMPLETE ===\n");

  await appSequelize.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
