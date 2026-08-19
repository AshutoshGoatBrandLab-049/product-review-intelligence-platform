import { appSequelize } from "../src/database/appStore/client.js";
import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";

async function test() {
  const schema = config.appStore.schema;

  console.log("Testing SQL query directly:\n");

  const query = `
WITH latest_per_product AS (
  SELECT
    nr.source_product_id,
    nr.rating,
    ROW_NUMBER() OVER (
      PARTITION BY nr.source_product_id
      ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC
    ) as review_rank
  FROM "${schema}".normalized_reviews nr
  WHERE nr.platform = 'flipkart' AND nr.source_product_id = 'FKPID000288'
),
latest_n AS (
  SELECT rating FROM latest_per_product
  WHERE review_rank <= 10
)
SELECT
  COUNT(*) as total_reviews,
  AVG(rating)::numeric as exact_avg,
  ROUND(AVG(rating)::numeric, 2) as rounded_avg,
  CAST(AVG(rating)::numeric AS DECIMAL(10,2)) as cast_avg
FROM latest_n
  `;

  try {
    const result = await appSequelize.query(query, { type: QueryTypes.SELECT });
    console.log("Query result:");
    console.log(JSON.stringify(result[0], null, 2));

    const row = result[0] as any;
    console.log(`\nValues:`);
    console.log(`  exact_avg: ${row.exact_avg} (type: ${typeof row.exact_avg})`);
    console.log(`  rounded_avg: ${row.rounded_avg} (type: ${typeof row.rounded_avg})`);
    console.log(`  cast_avg: ${row.cast_avg} (type: ${typeof row.cast_avg})`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await appSequelize.close();
  }
}

test();
