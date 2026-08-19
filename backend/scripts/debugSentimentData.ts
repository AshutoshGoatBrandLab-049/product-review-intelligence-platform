import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";

if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Run this against real dev DB, not test fixture");
}

async function main(): Promise<void> {
  console.log("=== Debugging Sentiment Data Availability ===\n");

  const schema = config.appStore.schema;

  // Check if review_sentiment table exists and has data
  const sentimentCheck = await appSequelize.query<{
    total_reviews: number;
    total_sentiment_records: number;
    pct_with_sentiment: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM "${schema}".normalized_reviews) as total_reviews,
      (SELECT COUNT(*) FROM "${schema}".review_sentiment) as total_sentiment_records,
      ROUND(100.0 * (SELECT COUNT(*) FROM "${schema}".review_sentiment) /
            NULLIF((SELECT COUNT(*) FROM "${schema}".normalized_reviews), 0), 2) as pct_with_sentiment`,
    { type: QueryTypes.SELECT },
  );

  console.log("Sentiment Data Coverage:");
  console.log(sentimentCheck[0]);

  // Check specific product's latest 10 reviews
  const productId = "FKPID000167";
  console.log(`\n\nLatest 10 reviews for ${productId}:`);

  const reviews = await appSequelize.query<{
    review_rank: number;
    canonical_review_id: string;
    rating: number | null;
    sentiment_label: string | null;
    review_text_preview: string;
  }>(
    `WITH latest AS (
      SELECT
        nr.canonical_review_id,
        nr.rating,
        nr.review_text,
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
      review_rank,
      canonical_review_id,
      rating,
      sentiment_label,
      SUBSTRING(review_text, 1, 50) as review_text_preview
    FROM latest
    WHERE review_rank <= 10
    ORDER BY review_rank ASC`,
    {
      replacements: { productId },
      type: QueryTypes.SELECT,
    },
  );

  console.log(`Found ${reviews.length} reviews:`);
  reviews.forEach((r) => {
    console.log(
      `  #${r.review_rank}: rating=${r.rating} sentiment=${r.sentiment_label ?? "NULL"} text="${r.review_text_preview}..."`,
    );
  });

  // Check how many reviews total have sentiment labels vs ratings
  const stats = await appSequelize.query<{
    total_in_latest10: number;
    with_rating: number;
    with_sentiment: number;
  }>(
    `WITH latest_per_product AS (
      SELECT
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
      WHERE nr.platform = 'flipkart'
    )
    SELECT
      COUNT(*) as total_in_latest10,
      COUNT(rating) as with_rating,
      COUNT(sentiment_label) as with_sentiment
    FROM latest_per_product
    WHERE review_rank <= 10`,
    { type: QueryTypes.SELECT },
  );

  console.log("\n\nAcross all Flipkart products, latest-10 reviews:");
  console.log(stats[0]);

  console.log("\n=== Conclusion ===");
  if ((stats[0]?.with_sentiment ?? 0) === 0) {
    console.log("⚠️  CRITICAL: Zero sentiment labels in latest-10 reviews");
    console.log("   This explains why all percentages show 0%");
    console.log("   Action needed: Populate review_sentiment table or use alternative metric");
  } else {
    console.log(`✓ Sentiment labels present: ${stats[0]?.with_sentiment} / ${stats[0]?.total_in_latest10}`);
  }
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
