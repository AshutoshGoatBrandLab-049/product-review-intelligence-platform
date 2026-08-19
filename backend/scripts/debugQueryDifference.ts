import { appSequelize } from "../src/database/appStore/client.js";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";

async function debugQueries() {
  const schema = config.appStore.schema;
  const platform = "flipkart";
  const sourceProductId = "FKPID000288";

  console.log("=== DEBUGGING QUERY DIFFERENCE ===\n");
  console.log(`Product: ${sourceProductId} on ${platform}\n`);

  try {
    // Query 1: getLatestNAverageRating logic (single product, 10 limit)
    console.log("Query 1: getLatestNAverageRating (for single product)");
    const query1 = `
WITH latest_per_product AS (
  SELECT
    nr.source_product_id,
    nr.platform,
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
  WHERE nr.platform = :platform AND nr.source_product_id = :sourceProductId
),
latest_n AS (
  SELECT * FROM latest_per_product
  WHERE review_rank <= 10
)
SELECT
  COUNT(*) as total_reviews,
  ROUND(AVG(rating)::numeric, 2) as average_rating,
  array_agg(rating ORDER BY rating DESC) as ratings
FROM latest_n
    `;

    const result1 = await appSequelize.query(query1, {
      replacements: { platform, sourceProductId },
      type: QueryTypes.SELECT,
    });
    console.log("Result 1:", JSON.stringify(result1[0], null, 2));

    // Query 2: getProductsRankedByPositiveReviews logic (all products, but filtered to this one)
    console.log("\n\nQuery 2: getProductsRankedByPositiveReviews (for all products)");
    const query2 = `
WITH latest_per_product AS (
  SELECT
    nr.source_product_id,
    nr.platform,
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
  WHERE nr.platform = :platform
),
latest_ten AS (
  SELECT * FROM latest_per_product
  WHERE review_rank <= 10
),
sentiment_counts AS (
  SELECT
    source_product_id,
    platform,
    COUNT(*) FILTER (WHERE sentiment_label = 'positive') as positive_count,
    COUNT(*) FILTER (WHERE sentiment_label = 'negative') as negative_count,
    COUNT(*) FILTER (WHERE sentiment_label = 'neutral') as neutral_count,
    COUNT(*) as total_in_latest_ten,
    ROUND(AVG(rating)::numeric, 2) as average_rating,
    array_agg(rating ORDER BY rating DESC) as ratings
  FROM latest_ten
  GROUP BY source_product_id, platform
)
SELECT
  source_product_id,
  platform,
  positive_count,
  negative_count,
  neutral_count,
  total_in_latest_ten,
  average_rating,
  ratings
FROM sentiment_counts
WHERE source_product_id = :sourceProductId
    `;

    const result2 = await appSequelize.query(query2, {
      replacements: { platform, sourceProductId },
      type: QueryTypes.SELECT,
    });
    console.log("Result 2:", JSON.stringify(result2[0], null, 2));

    // Direct query to see the actual latest 10 reviews for this product
    console.log("\n\nQuery 3: Direct latest 10 reviews for this product");
    const query3 = `
SELECT
  canonical_review_id,
  rating,
  review_timestamp,
  review_date,
  ROW_NUMBER() OVER (
    ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC
  ) as row_num
FROM "${schema}".normalized_reviews
WHERE platform = :platform AND source_product_id = :sourceProductId
ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC
LIMIT 10
    `;

    const result3 = await appSequelize.query(query3, {
      replacements: { platform, sourceProductId },
      type: QueryTypes.SELECT,
    });
    console.log("Result 3 (Direct latest 10):");
    console.log(JSON.stringify(result3, null, 2));

    const ratings = (result3 as any[]).map(r => r.rating);
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    console.log(`\nManual calc: ${ratings} = ${avg.toFixed(2)}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await appSequelize.close();
  }
}

debugQueries();
