import { runAiSentimentPipeline } from "../src/modules/ai/pipeline.js";
import { createAiProvider } from "../src/modules/ai/providers/providerFactory.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { isMainModule } from "../src/shared/isMainModule.js";
import type { Platform } from "../src/types/unifiedReview.js";

/**
 * Phase 4 §10/§23 — usage:
 *   npm run ai:sentiment -- --dry-run [--platform=flipkart]
 *   npm run ai:sentiment -- [--platform=flipkart] [--total-limit=50] [--batch-size=20]
 *
 * Dry-run makes zero AI calls and zero database writes — it only reports
 * candidate/stale/new counts. Always run dry-run before a real batch,
 * especially the first time. --total-limit caps how many reviews this
 * invocation processes in total (start with 20-100 per §23); --batch-size
 * controls per-DB-fetch granularity, independent of the total cap.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const platformArg = args.find((a) => a.startsWith("--platform="))?.split("=")[1] as Platform | undefined;
  const totalLimitArg = args.find((a) => a.startsWith("--total-limit="))?.split("=")[1];
  const batchSizeArg = args.find((a) => a.startsWith("--batch-size="))?.split("=")[1];

  const provider = createAiProvider();
  console.log(`Provider: ${provider.name} (${provider.modelVersion})${dryRun ? " — DRY RUN" : ""}`);

  const result = await runAiSentimentPipeline(
    {
      platform: platformArg,
      dryRun,
      batchSize: batchSizeArg ? Number(batchSizeArg) : config.ai.batchSize,
      totalLimit: totalLimitArg ? Number(totalLimitArg) : undefined,
    },
    provider,
  );

  console.log(JSON.stringify(result, null, 2));
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => appSequelize.close())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
