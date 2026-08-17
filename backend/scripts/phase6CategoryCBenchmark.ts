import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { QueryTypes } from "sequelize";
import { computeHealthScore } from "../src/modules/analytics/healthScore.js";
import { computeProductAnalytics } from "../src/modules/analytics/productAnalytics.js";
import { detectAllProductSignals } from "../src/modules/analytics/earlyWarning.js";
import { computeProblemsAggregate } from "../src/modules/analytics/problemsAggregate.js";
import { resolveNamedWindow } from "../src/modules/analytics/dateWindows.js";
import { config as cfg } from "../src/config/index.js";

// Phase 6 Step 2 — read-only Category C timing benchmark, kept as a
// permanent, rerunnable deliverable (same treatment as Phase 5's
// phase5EarlyWarningTuningStep4.ts) — its output is the evidence basis for
// the in-process cache TTL chosen in shared/cache.ts. Entirely read-only;
// refuses to run against the isolated test fixture, since it measures real
// catalog-wide cost, not fixture-scale behavior.
if (cfg.appStore.database === "pri_test_appstore") {
  throw new Error("Refusing to run: this benchmark measures real catalog-wide cost, not the isolated fixture");
}

const WINDOW = resolveNamedWindow("30d");

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(1)}ms`);
  return result;
}

async function forEachProductBatched<T>(
  batchSize: number,
  fn: (platform: "flipkart" | "myntra", sourceProductId: string) => Promise<T>,
): Promise<T[]> {
  const schema = config.appStore.schema;
  const products = await appSequelize.query<{ platform: "flipkart" | "myntra"; source_product_id: string }>(
    `SELECT platform, source_product_id FROM "${schema}".product_dimension ORDER BY platform, source_product_id`,
    { type: QueryTypes.SELECT },
  );
  const results: T[] = [];
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((p) => fn(p.platform, p.source_product_id)));
    results.push(...batchResults);
  }
  return results;
}

async function main(): Promise<void> {
  console.log(`=== Phase 6 Step 2 — Category C benchmark (window: ${WINDOW.start}..${WINDOW.end}) ===\n`);

  const countRows = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${config.appStore.schema}".product_dimension`,
    { type: QueryTypes.SELECT },
  );
  console.log(`Catalog size: ${countRows[0]!.count} products\n`);

  // Pool default is 5 connections (client.ts has no explicit pool config) —
  // benchmark concurrency matches that ceiling, not an arbitrary number.
  const CONCURRENCY = 5;

  console.log(`--- Executive dashboard proxy: computeHealthScore looped over full catalog (concurrency=${CONCURRENCY}) ---`);
  await timed("computeHealthScore full-catalog loop", () => forEachProductBatched(CONCURRENCY, (p, id) => computeHealthScore(p, id, WINDOW)));

  console.log(`\n--- Product rankings proxy: computeProductAnalytics looped over full catalog (concurrency=${CONCURRENCY}) ---`);
  await timed("computeProductAnalytics full-catalog loop", () => forEachProductBatched(CONCURRENCY, (p, id) => computeProductAnalytics(p, id, WINDOW)));

  console.log("\n--- detectAllProductSignals (internal keyset pagination, batchSize=100) ---");
  const sweep = await timed("detectAllProductSignals", () => detectAllProductSignals(WINDOW, config.earlyWarning, 100));
  console.log(`  productsScanned: ${sweep.productsScanned}, signals: ${sweep.signals.length}`);

  console.log("\n--- computeProblemsAggregate (single grouped SQL query, catalog-wide) ---");
  const problems = await timed("computeProblemsAggregate", () => computeProblemsAggregate({ window: WINDOW }));
  console.log(`  themes returned: ${problems.length}`);

  console.log("\n=== Benchmark complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("BENCHMARK FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await appSequelize.close();
  });
