import { appSequelize } from "../src/database/appStore/client.js";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";

async function verify() {
  const schema = config.appStore.schema;
  const platform = "flipkart";
  const sourceProductId = "FKPID000288";

  console.log(`=== VERIFYING ACTUAL LATEST 10 REVIEWS ===\n`);
  console.log(`Product: ${sourceProductId} on ${platform}\n`);

  try {
    // Get actual latest 10 reviews with ratings
    const result = await appSequelize.query(
      `
      SELECT
        rating,
        review_timestamp,
        review_date,
        ROW_NUMBER() OVER (ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC) as rank
      FROM "${schema}".normalized_reviews
      WHERE platform = :platform AND source_product_id = :sourceProductId
      ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC
      LIMIT 10
      `,
      { replacements: { platform, sourceProductId }, type: QueryTypes.SELECT }
    );

    const rows = result as any[];
    const ratings = rows.map(r => r.rating);
    const sum = ratings.reduce((a, b) => a + b, 0);
    const average = sum / ratings.length;
    const rounded = Math.round(average * 100) / 100;

    console.log("Latest 10 reviews:");
    rows.forEach((row, i) => {
      console.log(`  ${i + 1}. Rating: ${row.rating} (${row.review_date})`);
    });

    console.log(`\nManual Calculation:`);
    console.log(`  Ratings: [${ratings.join(", ")}]`);
    console.log(`  Sum: ${sum}`);
    console.log(`  Average: ${sum} / ${ratings.length} = ${average}`);
    console.log(`  Rounded to 2 decimals: ${rounded}`);

    console.log(`\nExpected in UI: ${rounded}`);
    console.log(`Actual in UI: 4.4`);

    if (rounded === 4.4) {
      console.log(`\n✅ CORRECT! Database matches UI value.`);
    } else {
      console.log(`\n❌ MISMATCH! Database shows ${rounded} but UI shows 4.4`);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await appSequelize.close();
  }
}

verify();
