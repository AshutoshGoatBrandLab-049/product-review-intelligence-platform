import { getLatestNAverageRating, getProductsRankedByPositiveReviews } from "../src/database/queries/productRankingQueries.js";
import { appSequelize } from "../src/database/appStore/client.js";

async function test() {
  console.log("=== TESTING REAL FUNCTIONS ===\n");

  const platform = "flipkart";
  const sourceProductId = "FKPID000288";

  try {
    // Test 1: getLatestNAverageRating
    console.log("Test 1: getLatestNAverageRating");
    const result1 = await getLatestNAverageRating(platform, sourceProductId, 10);
    console.log(`Average Rating: ${result1.averageRating}, Review Count: ${result1.reviewCount}`);

    // Test 2: getProductsRankedByPositiveReviews
    console.log("\nTest 2: getProductsRankedByPositiveReviews");
    const result2 = await getProductsRankedByPositiveReviews(platform, 100, 0);
    const product = result2.products.find(p => p.sourceProductId === sourceProductId);
    if (product) {
      console.log(`Average Rating: ${product.averageRating}, Total: ${product.totalInLatestTen}, Rank: ${product.rank}`);
    } else {
      console.log("Product not found in ranking!");
    }

    console.log(`\n✅ Both should show SAME average rating: ${result1.averageRating}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await appSequelize.close();
  }
}

test();
