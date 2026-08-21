/**
 * Live repair for gbl_data_lake."DataWarehouse".
 *
 * Runs the real ingestion pipeline (Track A) against the live database so the
 * canonical tables are rebuilt from the CURRENT source data. Replacement
 * detection decides what happens — this script never forces a particular path.
 *
 *   npx tsx scripts/liveRepair.ts --dry-run          # report only, no writes
 *   npx tsx scripts/liveRepair.ts --apply myntra     # repair one marketplace
 *   npx tsx scripts/liveRepair.ts --apply myntra flipkart
 *
 * Reads .env, so it targets whatever DB_* points at — asserts that is
 * gbl_data_lake before applying anything.
 */

import { QueryTypes } from "sequelize";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { getReplacementSignals } from "../src/modules/ingestion/sourceReplacement.js";
import { runTrackA } from "../src/modules/ingestion/trackA.js";
import { getLastSeenSourceId } from "../src/modules/ingestion/watermarkRepo.js";
import type { Platform } from "../src/types/unifiedReview.js";

const S = config.appStore.schema;
const SRC: Record<Platform, { table: string; pid: string }> = {
  myntra: { table: "myntra_reviews", pid: "product_id" },
  flipkart: { table: "flipkart_reviews", pid: "pid" },
};

async function consistency(platform: Platform) {
  const { table, pid } = SRC[platform];
  const [r] = (await appSequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM "${S}".${table})::int                                  AS src,
       (SELECT COALESCE(MAX(id),0) FROM "${S}".${table})::int                       AS "srcMaxId",
       (SELECT COUNT(*) FROM "${S}".normalized_reviews WHERE platform=$1)::int      AS canon,
       (SELECT COUNT(*) FROM "${S}".normalized_reviews nr WHERE nr.platform=$1
          AND NOT EXISTS (SELECT 1 FROM "${S}".${table} s
            WHERE s.review_id=nr.source_review_id AND s.${pid}::text=nr.source_product_id))::int AS ghosts,
       (SELECT COUNT(*) FROM "${S}".${table} s
          WHERE NOT EXISTS (SELECT 1 FROM "${S}".normalized_reviews nr WHERE nr.platform=$1
            AND nr.source_review_id=s.review_id AND nr.source_product_id=s.${pid}::text))::int AS missing,
       (SELECT COUNT(*) FROM "${S}".product_dimension WHERE platform=$1)::int       AS dim,
       (SELECT COUNT(*) FROM "${S}".product_daily_metrics WHERE platform=$1)::int   AS metrics,
       (SELECT COUNT(*) FROM "${S}".product_dimension pd WHERE pd.platform=$1
          AND NOT EXISTS (SELECT 1 FROM "${S}".normalized_reviews nr
            WHERE nr.platform=$1 AND nr.source_product_id=pd.source_product_id))::int AS "staleDim",
       (SELECT COUNT(*) FROM "${S}".product_daily_metrics m WHERE m.platform=$1
          AND NOT EXISTS (SELECT 1 FROM "${S}".normalized_reviews nr
            WHERE nr.platform=$1 AND nr.source_product_id=m.source_product_id
              AND nr.review_date=m.review_date))::int                                AS "staleMetrics"`,
    { type: QueryTypes.SELECT, bind: [platform] },
  )) as any[];
  return r;
}

function line(label: string, v: unknown) {
  console.log(`    ${label.padEnd(24)} ${v}`);
}

async function report(platform: Platform, header: string) {
  const c = await consistency(platform);
  const wm = await getLastSeenSourceId(platform);
  console.log(`  ${header}`);
  line("source rows", c.src);
  line("source MAX(id)", c.srcMaxId);
  line("canonical rows", c.canon);
  line("GHOST (canon not in src)", c.ghosts);
  line("MISSING (src not in canon)", c.missing);
  line("product_dimension", `${c.dim} (stale: ${c.staleDim})`);
  line("product_daily_metrics", `${c.metrics} (stale: ${c.staleMetrics})`);
  line("watermark", `${wm}${wm > c.srcMaxId ? "  ⚠️ STRANDED above source MAX(id)" : ""}`);
  return c;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  const platforms = (["myntra", "flipkart"] as const).filter((p) => args.includes(p));

  const [{ db }] = (await appSequelize.query("SELECT current_database() AS db", {
    type: QueryTypes.SELECT,
  })) as Array<{ db: string }>;

  console.log(`\nDatabase : ${db}.${S}`);
  console.log(`Mode     : ${dryRun ? "DRY RUN (no writes)" : apply ? "APPLY" : "(no mode — pass --dry-run or --apply)"}\n`);

  if (apply && db !== "gbl_data_lake") {
    throw new Error(`--apply expects gbl_data_lake, got '${db}'`);
  }
  if (!dryRun && !apply) process.exit(1);

  const targets: Platform[] = platforms.length ? [...platforms] : ["myntra", "flipkart"];

  for (const platform of targets) {
    console.log(`── ${platform.toUpperCase()} ${"─".repeat(50)}`);
    await report(platform, "BEFORE:");

    const s = await getReplacementSignals(platform, undefined, { exact: true });
    console.log("  DETECTION:");
    line("retention", s.retention === null ? "n/a" : s.retention.toFixed(4));
    line("retained / canonical", `${s.retainedCount} / ${s.canonicalCount}`);
    line("threshold", "0.05");
    line("verdict", s.isReplacement ? "REPLACEMENT → full resync" : "incremental");
    line("reason", s.reason);

    if (dryRun) {
      console.log(`\n  DRY RUN — no changes made.\n`);
      continue;
    }

    console.log("\n  APPLYING…");
    const started = Date.now();
    const result = await runTrackA(platform);
    console.log(
      `    ${result.status} — read=${result.rowsRead} inserted=${result.rowsInserted} ` +
        `rejected=${result.rowsRejected} watermark=${result.finalLastSeenSourceId} (${Date.now() - started}ms)\n`,
    );

    const after = await report(platform, "AFTER:");
    const ok = after.ghosts === 0 && after.missing === 0 && after.src === after.canon
      && after.staleDim === 0 && after.staleMetrics === 0;
    console.log(`\n  RESULT: ${ok ? "✅ canonical == current source, no stale rows" : "❌ INCONSISTENT"}\n`);
  }

  await appSequelize.close();
}

main().catch(async (err) => {
  console.error("\nFAILED:", err);
  await appSequelize.close();
  process.exit(1);
});
