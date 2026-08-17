import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";

/** Truncates every app-owned table — pri_test_appstore ONLY, never production. */
export async function resetAppStore(): Promise<void> {
  const schema = config.appStore.schema;
  await appSequelize.query(
    `TRUNCATE TABLE "${schema}".normalized_reviews, "${schema}".identity_anomalies, ` +
      `"${schema}".ingestion_rejects, "${schema}".ingestion_watermarks, ` +
      `"${schema}".product_dimension, "${schema}".product_daily_metrics, ` +
      `"${schema}".review_sentiment, "${schema}".review_theme, ` +
      `"${schema}".ai_processing_runs, "${schema}".product_family_mapping, "${schema}".ai_insights CASCADE`,
  );
}
