import { QueryTypes } from "sequelize";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";

if (config.appStore.database === "pri_test_appstore") {
  throw new Error("Run against real dev DB");
}

async function main(): Promise<void> {
  const productId = "FKPID000457";
  const platform = "flipkart";
  const schema = config.appStore.schema;

  console.log(`=== RATING DISCREPANCY INVESTIGATION ===\n`);
  console.log(`Product: ${productId} on ${platform}\n`);

  // SOURCE A: Review Ranking query (latest 10)
  console.log("SOURCE A — REVIEW RANKING (Latest 10 Reviews)\n");

  const rankingReviews = await appSequelize.query<{
    review_rank: number;
    canonical_review_id: string;
    review_timestamp: string | null;
    review_date: string;
    rating: number | null;
  }>(
    `WITH latest_per_product AS (
      SELECT
        nr.source_product_id,
        nr.canonical_review_id,
        nr.rating,
        nr.review_timestamp,
        nr.review_date,
        ROW_NUMBER() OVER (
          PARTITION BY nr.source_product_id
          ORDER BY COALESCE(nr.review_timestamp, nr.review_date::timestamp) DESC
        ) as review_rank
      FROM "${schema}".normalized_reviews nr
      WHERE nr.platform = :platform AND nr.source_product_id = :productId
    )
    SELECT
      review_rank,
      canonical_review_id,
      review_timestamp,
      review_date,
      rating
    FROM latest_per_product
    WHERE review_rank <= 10
    ORDER BY review_rank ASC`,
    {
      replacements: { platform, productId },
      type: QueryTypes.SELECT,
    },
  );

  console.log("Review # | Review ID | Date | Timestamp | Rating");
  let rankingSum = 0;
  let rankingCount = 0;

  rankingReviews.forEach((r) => {
    const ts = r.review_timestamp ? `${r.review_timestamp.substring(0, 19)}` : "NULL";
    console.log(`${r.review_rank} | ${r.canonical_review_id} | ${r.review_date} | ${ts} | ${r.rating ?? "NULL"}`);
    if (r.rating !== null) {
      rankingSum += r.rating;
      rankingCount++;
    }
  });

  const rankingAvg = rankingCount > 0 ? rankingSum / rankingCount : 0;
  const rankingAvgRounded = Math.round(rankingAvg * 100) / 100;

  console.log(`\nSum: ${rankingSum}`);
  console.log(`Count: ${rankingCount}`);
  console.log(`Raw Average: ${rankingAvg}`);
  console.log(`Rounded to 2 decimals: ${rankingAvgRounded}\n`);

  // SOURCE B: AI Analyst query (time window)
  console.log("\nSOURCE B — AI ANALYST (All Reviews in Time Window)\n");

  // Use a 30-day window ending today
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = today.toISOString().split("T")[0];
  const startDate = thirtyDaysAgo.toISOString().split("T")[0];

  console.log(`Using window: ${startDate} to ${endDate}\n`);

  // Query product_daily_metrics to get the aggregate
  const dailyMetrics = await appSequelize.query<{
    review_count: string;
    rating_sum: string;
  }>(
    `SELECT
       sum(review_count)::text AS review_count,
       sum(rating_sum)::text AS rating_sum
     FROM "${schema}".product_daily_metrics d
     WHERE d.platform = :platform
       AND d.source_product_id = :productId
       AND d.review_date >= :startDate
       AND d.review_date <= :endDate`,
    {
      replacements: { platform, productId, startDate, endDate },
      type: QueryTypes.SELECT,
    },
  );

  const analystCount = Number(dailyMetrics[0]?.review_count ?? 0);
  const analystSum = Number(dailyMetrics[0]?.rating_sum ?? 0);
  const analystAvg = analystCount > 0 ? analystSum / analystCount : 0;
  const analystAvgRounded = Math.round(analystAvg * 100) / 100;

  console.log(`Reviews in window (from product_daily_metrics): ${analystCount}`);
  console.log(`Rating sum from product_daily_metrics: ${analystSum}`);
  console.log(`Raw Average: ${analystAvg}`);
  console.log(`Rounded to 2 decimals: ${analystAvgRounded}\n`);

  // SOURCE C: Raw reviews query for window
  console.log("\nSOURCE C — ALL REVIEWS IN SAME TIME WINDOW (Verification)\n");

  const windowReviews = await appSequelize.query<{
    canonical_review_id: string;
    review_date: string;
    rating: number | null;
  }>(
    `SELECT
       canonical_review_id,
       review_date,
       rating
     FROM "${schema}".normalized_reviews
     WHERE platform = :platform
       AND source_product_id = :productId
       AND review_date >= :startDate
       AND review_date <= :endDate
     ORDER BY review_date DESC`,
    {
      replacements: { platform, productId, startDate, endDate },
      type: QueryTypes.SELECT,
    },
  );

  console.log(`Found ${windowReviews.length} reviews in window`);
  let windowSum = 0;
  let windowCount = 0;

  windowReviews.forEach((r, idx) => {
    console.log(`${idx + 1}. ${r.canonical_review_id} | ${r.review_date} | ${r.rating ?? "NULL"}`);
    if (r.rating !== null) {
      windowSum += r.rating;
      windowCount++;
    }
  });

  const windowAvg = windowCount > 0 ? windowSum / windowCount : 0;
  const windowAvgRounded = Math.round(windowAvg * 100) / 100;

  console.log(`\nSum: ${windowSum}`);
  console.log(`Count (rated): ${windowCount}`);
  console.log(`Raw Average: ${windowAvg}`);
  console.log(`Rounded to 2 decimals: ${windowAvgRounded}\n`);

  // COMPARISON
  console.log("\n=== COMPARISON ===\n");
  console.log(`Review Ranking (Latest 10): ${rankingAvgRounded}`);
  console.log(`AI Analyst (30-day window): ${analystAvgRounded}`);
  console.log(`All Reviews in Window: ${windowAvgRounded}`);
  console.log(`\nDifference (Ranking - Analyst): ${rankingAvgRounded - analystAvgRounded}`);

  console.log("\n=== ROOT CAUSE ANALYSIS ===\n");
  console.log("SOURCE A (Review Ranking):");
  console.log("  - Uses: normalized_reviews table");
  console.log("  - Selection: ROW_NUMBER() OVER ... ORDER BY timestamp DESC");
  console.log("  - Limit: Latest 10 reviews (by timestamp, regardless of date)");
  console.log("  - Calculation: ROUND(AVG(rating)::numeric, 2)");
  console.log(`  - Result: ${rankingAvgRounded}`);

  console.log("\nSOURCE B (AI Analyst):");
  console.log("  - Uses: product_daily_metrics table (aggregated)");
  console.log("  - Selection: All rows within date window");
  console.log("  - Filter: review_date >= startDate AND review_date <= endDate");
  console.log("  - Calculation: SUM(rating_sum) / SUM(review_count), rounded to 2 decimals");
  console.log(`  - Result: ${analystAvgRounded}`);

  console.log("\n=== CONCLUSION ===\n");
  if (rankingCount !== analystCount) {
    console.log(`❌ DISCREPANCY CONFIRMED`);
    console.log(`   Review Ranking uses ${rankingCount} reviews (latest 10)`);
    console.log(`   AI Analyst uses ${analystCount} reviews (all in time window)`);
    console.log(`   These are DIFFERENT DATASETS`);
  } else {
    console.log(`⚠️  Same review count but different averages`);
    console.log(`   Possible causes: rounding, NULL handling, or data timing differences`);
  }

  console.log(`\nBusiness Requirement:`);
  console.log(`  "Average rating should be based on the latest 10 reviews"`);
  console.log(`  - Review Ranking: ✓ Uses latest 10`);
  console.log(`  - AI Analyst: ✗ Uses time-window aggregates, NOT latest 10`);
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
