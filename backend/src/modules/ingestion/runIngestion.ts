import { randomUUID } from "node:crypto";
import { runStartupSafetyChecks } from "../../security/prodReadOnlyGuard.js";
import { acquireLock, releaseLock, LockHeldError, LockAcquisitionError } from "./watermarkRepo.js";
import { runTrackA } from "./trackA.js";
import { runTrackB } from "./trackB.js";
import { appSequelize } from "../../database/appStore/client.js";
import { prodPool } from "../../database/prodReadOnly/client.js";
import { logger } from "../../shared/logger.js";
import { isMainModule } from "../../shared/isMainModule.js";
import type { Platform } from "../../types/unifiedReview.js";

async function main(): Promise<void> {
  const platform = process.argv[2] as Platform | undefined;
  if (platform !== "flipkart" && platform !== "myntra") {
    console.error('Usage: runIngestion.ts <flipkart|myntra>');
    process.exit(1);
  }

  runStartupSafetyChecks();

  const jobId = randomUUID();

  try {
    await acquireLock(platform);
  } catch (err) {
    if (err instanceof LockHeldError) {
      logger.warn({ jobId, platform, status: "skipped", reason: "lock_held" }, "Ingestion skipped — lock already held");
      return;
    }
    if (err instanceof LockAcquisitionError) {
      logger.error(
        { jobId, platform, status: "failed", reason: "lock_acquisition_error", error: err.message },
        "Ingestion failed — could not acquire lock",
      );
      throw err;
    }
    throw err;
  }

  try {
    const trackAResult = await runTrackA(platform, jobId);
    const trackBResult = await runTrackB(platform, jobId);

    logger.info(
      { jobId, platform, status: "success", trackA: trackAResult, trackB: trackBResult },
      "Ingestion run complete",
    );
    console.log(JSON.stringify({ jobId, trackA: trackAResult, trackB: trackBResult }, null, 2));
  } finally {
    await releaseLock(platform);
  }
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => appSequelize.close())
    .then(() => prodPool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
