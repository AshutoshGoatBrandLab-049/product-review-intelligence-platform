import { Router, type Request, type Response } from "express";
import { runIngestion } from "../../modules/ingestion/runIngestion.js";
import { LockHeldError } from "../../modules/ingestion/watermarkRepo.js";
import { logger } from "../../shared/logger.js";
import type { Platform } from "../../types/unifiedReview.js";

const router = Router();

/**
 * OPTION B: REST API Endpoint for In-Process Ingestion
 * POST /api/ingestion/trigger
 *
 * Allows triggering ingestion from HTTP calls while keeping it in-process
 * This solves the WebSocket issue by running ingestion in the server process
 */
router.post("/ingestion/trigger", async (req: Request, res: Response) => {
  try {
    const { platform } = req.body as { platform: string };

    if (platform !== "flipkart" && platform !== "myntra") {
      res.status(400).json({ error: "Invalid platform. Must be 'flipkart' or 'myntra'" });
      return;
    }

    logger.info({ platform }, "[OPTION-B] Ingestion triggered via REST API");

    // Option B: Call ingestion directly in-process
    const result = await runIngestion(platform as Platform);

    res.status(200).json({
      status: "success",
      message: "Ingestion completed successfully",
      result,
    });
  } catch (error) {
    /**
     * Lock contention is NOT a server error.
     *
     * Another instance (or the automatic detector) already holding the platform
     * lock is normal, expected behaviour under multiple app instances — verified:
     * two backends triggered simultaneously produced one success and one refusal,
     * with no duplicate rows. Reporting that as 500 would page someone for the
     * system working correctly, and would hide real failures in the same bucket.
     * 409 Conflict says "retry later", which is exactly right.
     */
    if (error instanceof LockHeldError) {
      logger.info({ error: error.message }, "Ingestion trigger skipped — lock held by another worker");
      res.status(409).json({
        status: "conflict",
        message: (error as Error).message,
      });
      return;
    }

    logger.error({ error: (error as Error).message }, "[OPTION-B] Ingestion API failed");
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * Health check for ingestion readiness
 */
router.get("/ingestion/health", (req: Request, res: Response) => {
  res.json({ status: "ready", message: "Ingestion service is ready" });
});

export default router;
