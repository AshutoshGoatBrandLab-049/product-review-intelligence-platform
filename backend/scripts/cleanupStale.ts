/**
 * Run the production stale-data cleanup for one platform, in a transaction.
 *
 * Exists because Track A's INCREMENTAL path does not delete canonical rows whose
 * source rows were removed — only the replacement path does. Until deletion
 * handling is added to the incremental path, this is the supported way to
 * reconcile a source that shrank without being wholesale replaced.
 *
 *   npx tsx scripts/cleanupStale.ts <flipkart|myntra> [--dry-run]
 */

import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { cleanupStaleSourceData } from "../src/modules/ingestion/sourceReplacement.js";
import { synchronizeProductDimension, synchronizeProductDailyMetrics } from "../src/modules/analytics/synchronize.js";
import type { Platform } from "../src/types/unifiedReview.js";

const S = config.appStore.schema;

async function ghostCount(platform: Platform): Promise<number> {
  const table = platform === "myntra" ? "myntra_reviews" : "flipkart_reviews";
  const pid = platform === "myntra" ? "product_id" : "pid";
  const [r] = (await appSequelize.query(
    `SELECT COUNT(*)::int AS n FROM "${S}".normalized_reviews nr
      WHERE nr.platform = $1
        AND NOT EXISTS (SELECT 1 FROM "${S}".${table} s
          WHERE s.review_id = nr.source_review_id AND s.${pid}::text = nr.source_product_id)`,
    { type: QueryTypes.SELECT, bind: [platform] },
  )) as Array<{ n: number }>;
  return r.n;
}

async function main() {
  const platform = process.argv[2] as Platform;
  const dryRun = process.argv.includes("--dry-run");
  if (platform !== "myntra" && platform !== "flipkart") {
    throw new Error("usage: cleanupStale.ts <flipkart|myntra> [--dry-run]");
  }

  const before = await ghostCount(platform);
  console.log(`${platform}: ghost rows before = ${before}`);

  if (dryRun) {
    console.log("DRY RUN — no changes made.");
    await appSequelize.close();
    return;
  }
  if (before === 0) {
    console.log("nothing to clean.");
    await appSequelize.close();
    return;
  }

  await appSequelize.transaction(async (t) => {
    const result = await cleanupStaleSourceData(platform, t);
    console.log(
      `  deleted: reviews=${result.staleReviewsDeleted} products=${result.staleProductsDeleted} metrics=${result.staleMetricsDeleted}`,
    );
    if (result.affectedProducts.length > 0) {
      await synchronizeProductDimension(result.affectedProducts, t);
      await synchronizeProductDailyMetrics(result.affectedProducts, t);
    }
  });

  console.log(`${platform}: ghost rows after  = ${await ghostCount(platform)}`);
  await appSequelize.close();
}

main().catch(async (err) => {
  console.error("FAILED:", err);
  await appSequelize.close();
  process.exit(1);
});
