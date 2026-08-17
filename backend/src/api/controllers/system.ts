import type { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";

/** GET /v1/system/ingestion-status — direct read of ingestion_watermarks,
 * the existing pipeline-freshness table. Admin-only (see router.ts). */
export async function getIngestionStatus(_req: Request, res: Response): Promise<void> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query(`SELECT * FROM "${schema}".ingestion_watermarks ORDER BY platform`, { type: QueryTypes.SELECT });
  res.json({ watermarks: rows });
}

/** GET /v1/system/ai-usage — direct read of ai_processing_runs, the
 * existing AI-run audit trail. Admin-only (see router.ts). Bounded to the
 * most recent 50 runs — never an unbounded table scan. */
export async function getAiUsage(_req: Request, res: Response): Promise<void> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query(
    `SELECT * FROM "${schema}".ai_processing_runs ORDER BY started_at DESC LIMIT 50`,
    { type: QueryTypes.SELECT },
  );
  res.json({ runs: rows });
}
