import { randomUUID } from "node:crypto";
import { runStartupSafetyChecks } from "../../security/prodReadOnlyGuard.js";
import { acquireLock, releaseLock, LockHeldError, LockAcquisitionError } from "./watermarkRepo.js";
import { runTrackA } from "./trackA.js";
import { runTrackB } from "./trackB.js";
import { appSequelize } from "../../database/appStore/client.js";
import { logger } from "../../shared/logger.js";
import { isMainModule } from "../../shared/isMainModule.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * OPTION A: Direct function export for in-process ingestion
 * Can be called directly from server without spawning child process
 * This ensures WebSocket events reach the same server instance
 */
export async function runIngestion(platform: Platform, jobId: string = randomUUID()): Promise<{ trackA: any; trackB: any }> {
  try {
    await acquireLock(platform);
  } catch (err) {
    if (err instanceof LockHeldError) {
      logger.warn({ jobId, platform, status: "skipped", reason: "lock_held" }, "Ingestion skipped — lock already held");
      throw err;
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

    return { trackA: trackAResult, trackB: trackBResult };
  } finally {
    await releaseLock(platform);
  }
}

async function main(): Promise<void> {
  const platform = process.argv[2] as Platform | undefined;
  if (platform !== "flipkart" && platform !== "myntra") {
    console.error('Usage: runIngestion.ts <flipkart|myntra>');
    process.exit(1);
  }

  runStartupSafetyChecks();

  const jobId = randomUUID();

  try {
    const result = await runIngestion(platform, jobId);
    console.log(JSON.stringify({ jobId, ...result }, null, 2));
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Ingestion failed");
  }
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
