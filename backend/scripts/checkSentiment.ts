import { appSequelize } from "../src/database/appStore/client.js";
import { QueryTypes } from "sequelize";

async function check() {
  const result = await appSequelize.query(
    `
    SELECT
      nr.canonical_review_id,
      nr.rating,
      rs.label as sentiment_label
    FROM gbl_data_lake."NormalizedReview" nr
    LEFT JOIN gbl_data_lake."ReviewSentiment" rs
      ON nr.canonical_review_id = rs.canonical_review_id
    WHERE nr.platform = 'flipkart' AND nr.source_product_id = 'FKPID000288'
    ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC
    LIMIT 10
  `,
    { type: QueryTypes.SELECT }
  );

  console.log("Ratings vs Sentiment Labels:");
  (result as any[]).forEach((row) => {
    console.log(`Rating: ${row.rating}, Sentiment: ${row.sentiment_label}`);
  });

  await appSequelize.close();
}

check();
