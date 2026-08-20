import { appSequelize } from "../src/database/appStore/client.js";
import { QueryTypes } from "sequelize";

async function captureBaseline() {
  try {
    console.log("=== Phase 2D: Baseline Metrics Capture ===\n");

    // Myntra Source Data
    const myntraSource = await appSequelize.query(
      `SELECT COUNT(*) as count, COALESCE(MAX(id), 0) as max_id, COALESCE(MIN(id), 0) as min_id
       FROM "DataWarehouse".myntra_reviews`,
      { type: QueryTypes.SELECT }
    );
    console.log("📊 Myntra Source (DataWarehouse.myntra_reviews):");
    console.log(JSON.stringify(myntraSource[0], null, 2));

    // Myntra Normalized Reviews
    const myntraNormalized = await appSequelize.query(
      `SELECT COUNT(*) as count, COALESCE(MAX(source_row_id), 0) as max_source_row_id
       FROM app_store.normalized_reviews WHERE platform = 'myntra'`,
      { type: QueryTypes.SELECT }
    );
    console.log("\n📊 Myntra Normalized Reviews:");
    console.log(JSON.stringify(myntraNormalized[0], null, 2));

    // Myntra Product Dimension
    const myntraProducts = await appSequelize.query(
      `SELECT COUNT(*) as count, COUNT(DISTINCT source_product_id) as distinct_products
       FROM app_store.product_dimension WHERE platform = 'myntra'`,
      { type: QueryTypes.SELECT }
    );
    console.log("\n📊 Myntra Product Dimension:");
    console.log(JSON.stringify(myntraProducts[0], null, 2));

    // Myntra Metrics
    const myntraMetrics = await appSequelize.query(
      `SELECT COUNT(*) as count, MIN(review_date) as min_date, MAX(review_date) as max_date
       FROM app_store.product_daily_metrics WHERE platform = 'myntra'`,
      { type: QueryTypes.SELECT }
    );
    console.log("\n📊 Myntra Product Daily Metrics:");
    console.log(JSON.stringify(myntraMetrics[0], null, 2));

    // Flipkart Source (for comparison)
    const flipkartSource = await appSequelize.query(
      `SELECT COUNT(*) as count, COALESCE(MAX(id), 0) as max_id
       FROM "DataWarehouse".flipkart_reviews`,
      { type: QueryTypes.SELECT }
    );
    console.log("\n📊 Flipkart Source (DataWarehouse.flipkart_reviews):");
    console.log(JSON.stringify(flipkartSource[0], null, 2));

    // Flipkart Normalized Reviews
    const flipkartNormalized = await appSequelize.query(
      `SELECT COUNT(*) as count, COALESCE(MAX(source_row_id), 0) as max_source_row_id
       FROM app_store.normalized_reviews WHERE platform = 'flipkart'`,
      { type: QueryTypes.SELECT }
    );
    console.log("\n📊 Flipkart Normalized Reviews:");
    console.log(JSON.stringify(flipkartNormalized[0], null, 2));

    // Watermarks
    const watermarks = await appSequelize.query(
      `SELECT platform, last_seen_source_id FROM app_store.ingestion_watermarks ORDER BY platform`,
      { type: QueryTypes.SELECT }
    );
    console.log("\n📊 Current Watermarks:");
    console.log(JSON.stringify(watermarks, null, 2));

    console.log("\n✅ Baseline metrics captured successfully");

    await appSequelize.close();
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

captureBaseline();
