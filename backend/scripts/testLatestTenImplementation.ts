import { getLatestNAverageRating } from "../src/database/queries/productRankingQueries.js";
import { appSequelize } from "../src/database/appStore/client.js";

async function main(): Promise<void> {
  console.log("=== Testing Latest-N Average Rating Implementation ===\n");

  const productId = "FKPID000457";
  const platform = "flipkart";

  console.log(`Testing product: ${productId} on ${platform}\n`);

  try {
    // Test with latest 10 reviews
    const result10 = await getLatestNAverageRating(platform, productId, 10);
    console.log("Result from getLatestNAverageRating(platform, productId, 10):");
    console.log(`  Average Rating: ${result10.averageRating} (type: ${typeof result10.averageRating})`);
    console.log(`  Review Count: ${result10.reviewCount}`);

    // Test with latest 20 reviews
    const result20 = await getLatestNAverageRating(platform, productId, 20);
    console.log("\nResult from getLatestNAverageRating(platform, productId, 20):");
    console.log(`  Average Rating: ${result20.averageRating} (type: ${typeof result20.averageRating})`);
    console.log(`  Review Count: ${result20.reviewCount}`);

    console.log("\n=== VERIFICATION ===");
    console.log(`Expected (latest 10): Average 4.9 (from 10 reviews)`);
    console.log(`Actual (latest 10): Average ${result10.averageRating} (from ${result10.reviewCount} reviews)`);

    // Handle both number and string cases
    const ratingValue10 = typeof result10.averageRating === "number" ? result10.averageRating : parseFloat(String(result10.averageRating || 0));
    const ratingStr10 = ratingValue10.toFixed(2);

    if (ratingStr10 === "4.90" && result10.reviewCount === 10) {
      console.log("\n✅ PASS: Latest-10 implementation is correct!");
    } else {
      console.log("\n❌ FAIL: Latest-10 implementation does not match expected values");
      console.log(`Details: expected 4.90/10, got ${ratingStr10}/${result10.reviewCount}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await appSequelize.close();
  });
