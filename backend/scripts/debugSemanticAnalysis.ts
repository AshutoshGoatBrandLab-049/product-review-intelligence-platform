/**
 * DEBUG: Verify semantic analysis is actually producing results
 * and trace where they're being lost in the pipeline
 */

import { analyzeProductReviewsForIntent } from "../src/modules/ai/semanticAnalysis.js";
import { MockAiProvider } from "../src/modules/ai/providers/mockAiProvider.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { QueryTypes } from "sequelize";
import { AnalyticalIntent } from "../src/modules/ai/intentDetection.js";

async function main() {
  console.log("\n=== SEMANTIC ANALYSIS DEBUG ===\n");

  const schema = config.appStore.schema;

  // Get all reviews for FKPID000001
  const reviews = (await appSequelize.query<any>(
    `SELECT
      canonical_review_id,
      platform,
      source_product_id,
      rating,
      review_text,
      title
     FROM "${schema}".normalized_reviews
     WHERE platform = 'flipkart' AND source_product_id = 'FKPID000001'
     ORDER BY rating DESC`,
    { type: QueryTypes.SELECT, raw: true },
  )) as any[];

  console.log(`Total reviews for FKPID000001: ${reviews.length}`);
  console.log(`Negative reviews (rating ≤ 2): ${reviews.filter((r) => r.rating <= 2).length}\n`);

  // Test semantic analysis with mock provider
  const mockProvider = new MockAiProvider();

  console.log("Running semantic analysis for TOP_PROBLEM intent...\n");

  const result = await analyzeProductReviewsForIntent(reviews, AnalyticalIntent.TOP_PROBLEM, mockProvider);

  console.log("=== SEMANTIC ANALYSIS OUTPUT ===\n");
  console.log(`Reviews analyzed: ${result.metadata.reviewsAnalyzed}`);
  console.log(`Reviews with null text: ${result.metadata.reviewsWithNullText}`);
  console.log(`Total aspects found: ${result.aspects.length}\n`);

  for (const aspect of result.aspects) {
    console.log(`Aspect: "${aspect.aspect}"`);
    console.log(`  Count: ${aspect.count}`);
    console.log(`  Percentage: ${aspect.percentage.toFixed(2)}%`);
    console.log(`  Sentiments: ${JSON.stringify(aspect.sentiments)}`);
    console.log(`  Has conflicting sentiment: ${aspect.hasConflictingSentiment}`);
    console.log(`  Review IDs (${aspect.reviewIds.length}):`);
    aspect.reviewIds.forEach((id, i) => {
      if (i < 5) console.log(`    [${i + 1}] ${id}`);
    });
    if (aspect.reviewIds.length > 5) {
      console.log(`    ... and ${aspect.reviewIds.length - 5} more`);
    }
    console.log();
  }

  // Now check what's in review_theme table for comparison
  console.log("\n=== DATABASE THEME DATA (FOR COMPARISON) ===\n");

  const themeData = (await appSequelize.query<any>(
    `SELECT
      rt.theme,
      COUNT(DISTINCT nr.canonical_review_id) as count,
      STRING_AGG(DISTINCT nr.canonical_review_id, ', ') as review_ids
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_theme rt ON nr.canonical_review_id = rt.canonical_review_id
     WHERE nr.platform = 'flipkart' AND nr.source_product_id = 'FKPID000001' AND nr.rating <= 2
     GROUP BY rt.theme
     ORDER BY count DESC`,
    { type: QueryTypes.SELECT, raw: true },
  )) as any[];

  for (const row of themeData) {
    console.log(
      `Theme: "${row.theme || '(null/unclassified)'}" - Count: ${row.count}\n  IDs: ${row.review_ids ? row.review_ids.split(",").slice(0, 3).join(", ") : "(none)"}${row.review_ids && row.review_ids.split(",").length > 3 ? "..." : ""}\n`,
    );
  }

  console.log("\n=== CRITICAL QUESTION ===");
  console.log(
    "\nIf semantic analysis found aspects with high counts,\nbut database themes show only 2 reviews with 'quality',\nWHERE are the semantic results being lost?\n",
  );

  await appSequelize.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
