import { rebuildAnalytics } from "../src/modules/analytics/rebuild.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 3 §"AGGREGATION REBUILD TRIGGER" — manual only, per approval.
 * Deliberately NOT wired into runIngestion.ts — ingestion and analytics stay
 * separate failure domains. Run this explicitly after Track A/B complete:
 *
 *   npm run analytics:rebuild
 */
async function main(): Promise<void> {
  const result = await rebuildAnalytics();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "success") {
    console.error("Analytics rebuild FAILED — prior aggregate tables are unchanged.");
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => appSequelize.close())
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
