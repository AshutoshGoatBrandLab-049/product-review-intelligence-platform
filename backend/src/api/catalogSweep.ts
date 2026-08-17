import { QueryTypes } from "sequelize";
import { appSequelize } from "../database/appStore/client.js";
import { config } from "../config/index.js";
import { computeHealthScore, type HealthScore } from "../modules/analytics/healthScore.js";
import { computeProductAnalytics, type ProductAnalytics } from "../modules/analytics/productAnalytics.js";
import type { DateWindow } from "../modules/analytics/dateWindows.js";
import type { Platform } from "../types/unifiedReview.js";

/**
 * Phase 6 Step 2 — catalog-wide orchestration for the Category C endpoints
 * (executive dashboard, rankings). This is deliberately NOT a new business
 * calculation: it only lists which products exist and loops the existing
 * computeHealthScore/computeProductAnalytics functions over them — every
 * actual number still comes from Phase 3/4's own code. Concurrency=5 matches
 * the real benchmark (scripts/phase6CategoryCBenchmark.ts) and the app
 * store's default Sequelize pool size (client.ts sets no explicit pool
 * config, so the driver default of 5 applies) — a higher concurrency here
 * would just queue at the pool, not actually go faster.
 */
export const CATALOG_LOOP_CONCURRENCY = 5;

export interface CatalogProductRef {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
}

export async function listCatalogProducts(platform?: Platform, brand?: string): Promise<CatalogProductRef[]> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<{ platform: Platform; source_product_id: string; brand: string | null }>(
    `SELECT platform, source_product_id, brand FROM "${schema}".product_dimension
     WHERE (:platform::text IS NULL OR platform = :platform)
       AND (:brand::text IS NULL OR brand = :brand)
     ORDER BY platform, source_product_id`,
    { type: QueryTypes.SELECT, replacements: { platform: platform ?? null, brand: brand ?? null } },
  );
  return rows.map((r) => ({ platform: r.platform, sourceProductId: r.source_product_id, brand: r.brand }));
}

async function mapCatalogBatched<T>(products: CatalogProductRef[], fn: (p: CatalogProductRef) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < products.length; i += CATALOG_LOOP_CONCURRENCY) {
    const batch = products.slice(i, i + CATALOG_LOOP_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

export interface CatalogHealthEntry {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
  health: HealthScore;
}

export async function computeCatalogHealthScores(window: DateWindow, platform?: Platform, brand?: string): Promise<CatalogHealthEntry[]> {
  const products = await listCatalogProducts(platform, brand);
  return mapCatalogBatched(products, async (p) => ({
    platform: p.platform,
    sourceProductId: p.sourceProductId,
    brand: p.brand,
    health: await computeHealthScore(p.platform, p.sourceProductId, window),
  }));
}

export interface CatalogAnalyticsEntry {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
  analytics: ProductAnalytics;
}

export async function computeCatalogAnalytics(window: DateWindow, platform?: Platform, brand?: string): Promise<CatalogAnalyticsEntry[]> {
  const products = await listCatalogProducts(platform, brand);
  return mapCatalogBatched(products, async (p) => ({
    platform: p.platform,
    sourceProductId: p.sourceProductId,
    brand: p.brand,
    analytics: await computeProductAnalytics(p.platform, p.sourceProductId, window),
  }));
}
