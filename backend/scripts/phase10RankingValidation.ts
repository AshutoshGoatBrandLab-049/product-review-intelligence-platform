import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { getProductsRankedByNegativeReviews, getProductsRankedByPositiveReviews } from "../src/database/queries/productRankingQueries.js";

if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Run this against real dev DB, not test fixture");
}

async function main(): Promise<void> {
  console.log("=== STEP 6 VALIDATION: Product Ranking by Average Rating ===\n");

  const schema = config.appStore.schema;

  // Fetch real data from the API layer
  console.log("NEGATIVE RANKINGS:");
  const negativeResult = await getProductsRankedByNegativeReviews("flipkart", 5, 0);
  console.log(`Total products on Flipkart (negative ranking): ${negativeResult.total}\n`);

  for (let i = 0; i < Math.min(3, negativeResult.products.length); i++) {
    const product = negativeResult.products[i]!;
    console.log(`  Rank #${product.rank}: ${product.sourceProductId}`);
    console.log(`    - Average Rating: ${product.averageRating}`);
    console.log(`    - Latest 10 count: ${product.totalInLatestTen}`);
    console.log(`    - Sentiment: ${product.positiveCount}+ / ${product.negativeCount}- / ${product.neutralCount}○`);
    const negPercent = Math.round((product.negativeCount / product.totalInLatestTen) * 100);
    console.log(`    - Negative %: ${negPercent}%\n`);

    // Verify this product's latest 10 reviews and their ratings
    const verifyQuery = `
WITH latest_per_product AS (
  SELECT
    nr.source_product_id,
    nr.canonical_review_id,
    nr.rating,
    rs.label as sentiment_label,
    ROW_NUMBER() OVER (
      PARTITION BY nr.source_product_id
      ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC
    ) as review_rank
  FROM "${schema}".normalized_reviews nr
  LEFT JOIN "${schema}".review_sentiment rs
    ON nr.canonical_review_id = rs.canonical_review_id
  WHERE nr.platform = 'flipkart' AND nr.source_product_id = :productId
)
SELECT
  canonical_review_id,
  rating,
  sentiment_label,
  review_rank
FROM latest_per_product
WHERE review_rank <= 10
ORDER BY review_rank ASC;
    `;

    const latestReviews = (await appSequelize.query(verifyQuery, {
      replacements: { productId: product.sourceProductId },
      type: QueryTypes.SELECT,
    })) as Array<{
      canonical_review_id: string;
      rating: number | null;
      sentiment_label: string | null;
      review_rank: number;
    }>;

    if (latestReviews.length > 0) {
      console.log(`    📋 Latest 10 reviews for verification:`);
      const ratings = latestReviews.filter((r) => r.rating !== null).map((r) => r.rating as number);
      const sum = ratings.reduce((a, b) => a + b, 0);
      const avg = sum / ratings.length;
      const calculatedAvg = Math.round(avg * 100) / 100;

      latestReviews.forEach((r) => {
        console.log(
          `      • ${r.review_rank}: rating=${r.rating ?? "null"} sentiment=${r.sentiment_label ?? "null"}`,
        );
      });

      console.log(`    ✓ Calculated average: ${calculatedAvg} (from ${ratings.length} rated reviews)`);
      console.log(`    ✓ API average: ${product.averageRating}`);
      console.log(`    ✓ Match: ${calculatedAvg === product.averageRating ? "✓ YES" : "✗ NO"}\n`);
    }
  }

  // Now check positive rankings
  console.log("\n\nPOSITIVE RANKINGS:");
  const positiveResult = await getProductsRankedByPositiveReviews("flipkart", 5, 0);
  console.log(`Total products on Flipkart (positive ranking): ${positiveResult.total}\n`);

  for (let i = 0; i < Math.min(3, positiveResult.products.length); i++) {
    const product = positiveResult.products[i]!;
    console.log(`  Rank #${product.rank}: ${product.sourceProductId}`);
    console.log(`    - Average Rating: ${product.averageRating}`);
    console.log(`    - Latest 10 count: ${product.totalInLatestTen}`);
    console.log(`    - Sentiment: ${product.positiveCount}+ / ${product.negativeCount}- / ${product.neutralCount}○`);
    const posPercent = Math.round((product.positiveCount / product.totalInLatestTen) * 100);
    console.log(`    - Positive %: ${posPercent}%\n`);
  }

  // Verify ranking order
  console.log("\n\nVERIFYING RANKING ORDER:");
  console.log("Negative ranking (should be ASC by average_rating):");
  if (negativeResult.products.length >= 2) {
    const first = negativeResult.products[0]!.averageRating;
    const second = negativeResult.products[1]!.averageRating;
    console.log(
      `  Rank #1 average: ${first}, Rank #2 average: ${second}`,
      first <= second ? "✓ CORRECT (ASC)" : "✗ WRONG (should be ASC)",
    );
  }

  console.log("\nPositive ranking (should be DESC by average_rating):");
  if (positiveResult.products.length >= 2) {
    const first = positiveResult.products[0]!.averageRating;
    const second = positiveResult.products[1]!.averageRating;
    console.log(
      `  Rank #1 average: ${first}, Rank #2 average: ${second}`,
      first >= second ? "✓ CORRECT (DESC)" : "✗ WRONG (should be DESC)",
    );
  }

  console.log("\n=== VALIDATION COMPLETE ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await appSequelize.close();
  });
