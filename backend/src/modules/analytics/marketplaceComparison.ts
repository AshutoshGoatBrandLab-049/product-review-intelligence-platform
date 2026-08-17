import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import { computeBrandAnalytics, type BrandAnalytics } from "./brandAnalytics.js";
import { computeProductAnalytics, type ProductAnalytics } from "./productAnalytics.js";
import { comparePeriods, type PeriodComparison } from "./periodComparison.js";
import { CONFIDENCE_THRESHOLDS } from "./confidence.js";
import type { DateWindow } from "./dateWindows.js";
import type { Platform } from "../../types/unifiedReview.js";

/**
 * Phase 5 Step 5 — §15's three-bucket classification. Never auto-classifies
 * past the sample-size floor: "insufficient_evidence" is returned explicitly
 * rather than defaulting to a guess, per the original architecture's own
 * instruction ("the system says so explicitly rather than defaulting to a
 * 'product-level' guess").
 */
export type ThemeConsistencyClassification = "marketplace_consistent" | "marketplace_specific" | "insufficient_evidence";

/**
 * Starting hypothesis, NOT empirically tuned against real data (unlike Step
 * 4's early-warning thresholds) — same "unvalidated hypothesis, stated
 * explicitly" treatment this project gives every other unproven constant
 * (health-score weights, original early-warning thresholds before Step 4).
 * Frequencies within this ratio of each other are treated as comparable;
 * beyond it, as platform-skewed.
 */
export const THEME_CONSISTENCY_RATIO_BAND = 2.0;

export interface ThemeConsistencyResult {
  theme: string;
  flipkartFrequencyPercent: number | null;
  myntraFrequencyPercent: number | null;
  flipkartSampleSize: number;
  myntraSampleSize: number;
  classification: ThemeConsistencyClassification;
}

/**
 * Sample size here means total reviews on that platform for the brand (the
 * frequency estimate's denominator) — the same quantity CONFIDENCE_THRESHOLDS
 * already gates elsewhere in this module, not the theme's raw mention count.
 */
export function classifyThemeConsistency(
  flipkartFrequencyPercent: number | null,
  flipkartSampleSize: number,
  myntraFrequencyPercent: number | null,
  myntraSampleSize: number,
  minSampleSize: number = CONFIDENCE_THRESHOLDS.minReviewsForLowConfidence,
  ratioBand: number = THEME_CONSISTENCY_RATIO_BAND,
): ThemeConsistencyClassification {
  if (flipkartSampleSize < minSampleSize || myntraSampleSize < minSampleSize) {
    return "insufficient_evidence";
  }
  const flipkartFreq = flipkartFrequencyPercent ?? 0;
  const myntraFreq = myntraFrequencyPercent ?? 0;
  if (flipkartFreq === 0 && myntraFreq === 0) return "marketplace_consistent";
  const higher = Math.max(flipkartFreq, myntraFreq);
  const lower = Math.min(flipkartFreq, myntraFreq);
  if (lower === 0) return "marketplace_specific"; // present on one side, genuinely absent on the other, despite adequate sample size
  return higher / lower <= ratioBand ? "marketplace_consistent" : "marketplace_specific";
}

async function getBrandThemeCounts(brand: string, platform: "flipkart" | "myntra", window: DateWindow): Promise<Record<string, number>> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<{ theme: string; count: string }>(
    `SELECT rt.theme, count(*)::text AS count
     FROM "${schema}".review_theme rt
     JOIN "${schema}".normalized_reviews nr ON nr.canonical_review_id = rt.canonical_review_id
     JOIN "${schema}".product_dimension pd ON pd.platform = nr.platform AND pd.source_product_id = nr.source_product_id
     WHERE pd.brand = :brand AND nr.platform = :platform
       AND nr.review_date >= :start AND nr.review_date <= :end
     GROUP BY rt.theme`,
    { type: QueryTypes.SELECT, replacements: { brand, platform, start: window.start, end: window.end } },
  );
  return Object.fromEntries(rows.map((r) => [r.theme, Number(r.count)]));
}

export interface BrandMarketplaceComparison {
  brand: string;
  window: DateWindow;
  flipkart: BrandAnalytics;
  myntra: BrandAnalytics;
  /** current = flipkart's average rating, previous = myntra's — reusing
   * comparePeriods' calculation for a platform-vs-platform delta, not a
   * time-period comparison; the field names are its own, not renamed here. */
  ratingComparison: PeriodComparison;
  themeConsistency: ThemeConsistencyResult[];
}

/**
 * Phase 5 Step 5 — brand-level Flipkart-vs-Myntra comparison, the day-one
 * capability §15 calls for (no product-id mapping needed — brand_name exists
 * on both sources today). Reuses computeBrandAnalytics (Phase 3) for each
 * platform's numbers rather than recomputing anything.
 */
export async function compareBrandAcrossMarketplaces(brand: string, window: DateWindow): Promise<BrandMarketplaceComparison> {
  const [flipkart, myntra, flipkartThemeCounts, myntraThemeCounts] = await Promise.all([
    computeBrandAnalytics(brand, window, "flipkart"),
    computeBrandAnalytics(brand, window, "myntra"),
    getBrandThemeCounts(brand, "flipkart", window),
    getBrandThemeCounts(brand, "myntra", window),
  ]);

  const ratingComparison = comparePeriods(flipkart.recentMetrics.averageRating ?? 0, myntra.recentMetrics.averageRating ?? 0);

  const allThemes = new Set([...Object.keys(flipkartThemeCounts), ...Object.keys(myntraThemeCounts)]);
  const flipkartTotal = flipkart.recentMetrics.totalReviews;
  const myntraTotal = myntra.recentMetrics.totalReviews;

  const themeConsistency: ThemeConsistencyResult[] = [...allThemes].sort().map((theme) => {
    const flipkartCount = flipkartThemeCounts[theme] ?? 0;
    const myntraCount = myntraThemeCounts[theme] ?? 0;
    const flipkartFrequencyPercent = flipkartTotal === 0 ? null : Math.round((flipkartCount / flipkartTotal) * 10000) / 100;
    const myntraFrequencyPercent = myntraTotal === 0 ? null : Math.round((myntraCount / myntraTotal) * 10000) / 100;
    return {
      theme,
      flipkartFrequencyPercent,
      myntraFrequencyPercent,
      flipkartSampleSize: flipkartTotal,
      myntraSampleSize: myntraTotal,
      classification: classifyThemeConsistency(flipkartFrequencyPercent, flipkartTotal, myntraFrequencyPercent, myntraTotal),
    };
  });

  return { brand, window, flipkart, myntra, ratingComparison, themeConsistency };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 Step 6 — product-family-mapping (gated product-level comparison).
// The mapping table is genuinely empty on a fresh deploy (no data populated
// this step, or any step) — everything below correctly returns "no mapping"
// until someone deliberately, manually populates a row. Nothing here ever
// infers or fuzzy-matches a Flipkart pid to a Myntra product_id.
// ─────────────────────────────────────────────────────────────────────────

export interface ProductFamily {
  familyId: string;
  flipkartSourceProductId: string;
  myntraSourceProductId: string;
  notes: string | null;
  createdAt: Date;
}

interface ProductFamilyRow {
  family_id: string;
  flipkart_source_product_id: string;
  myntra_source_product_id: string;
  notes: string | null;
  created_at: Date;
}

function toProductFamily(row: ProductFamilyRow): ProductFamily {
  return {
    familyId: row.family_id,
    flipkartSourceProductId: row.flipkart_source_product_id,
    myntraSourceProductId: row.myntra_source_product_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/**
 * Looks up whether a specific platform-scoped product already belongs to a
 * mapped family. Returns null (not a guess, not a fuzzy match) if it doesn't
 * — since the table is empty by default, this returns null for every real
 * product until someone deliberately adds a mapping row.
 */
export async function getProductFamily(platform: Platform, sourceProductId: string): Promise<ProductFamily | null> {
  const schema = config.appStore.schema;
  const column = platform === "flipkart" ? "flipkart_source_product_id" : "myntra_source_product_id";
  const rows = await appSequelize.query<ProductFamilyRow>(
    `SELECT family_id, flipkart_source_product_id, myntra_source_product_id, notes, created_at
     FROM "${schema}".product_family_mapping WHERE ${column} = :sourceProductId`,
    { type: QueryTypes.SELECT, replacements: { sourceProductId } },
  );
  return rows[0] ? toProductFamily(rows[0]) : null;
}

async function getProductFamilyById(familyId: string): Promise<ProductFamily | null> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<ProductFamilyRow>(
    `SELECT family_id, flipkart_source_product_id, myntra_source_product_id, notes, created_at
     FROM "${schema}".product_family_mapping WHERE family_id = :familyId`,
    { type: QueryTypes.SELECT, replacements: { familyId } },
  );
  return rows[0] ? toProductFamily(rows[0]) : null;
}

export type ProductMarketplaceComparison =
  | {
      available: true;
      familyId: string;
      flipkartSourceProductId: string;
      myntraSourceProductId: string;
      window: DateWindow;
      flipkart: ProductAnalytics;
      myntra: ProductAnalytics;
      /** current = flipkart's average rating, previous = myntra's — see the
       * identical note on BrandMarketplaceComparison.ratingComparison above. */
      ratingComparison: PeriodComparison;
    }
  | {
      available: false;
      familyId: string;
      reason: "no_mapping";
    };

/**
 * Phase 5 Step 6 — product-level marketplace comparison, gated entirely
 * behind an explicit product_family_mapping row. If none exists for the
 * given familyId, returns an explicit "no mapping available" result — never
 * guesses a Flipkart-Myntra pairing from product attributes, titles, or
 * anything else. Reuses computeProductAnalytics (Phase 3) for each side,
 * exactly the same pattern compareBrandAcrossMarketplaces (Step 5) uses.
 */
export async function compareProductByFamily(familyId: string, window: DateWindow): Promise<ProductMarketplaceComparison> {
  const family = await getProductFamilyById(familyId);
  if (!family) {
    return { available: false, familyId, reason: "no_mapping" };
  }

  const [flipkart, myntra] = await Promise.all([
    computeProductAnalytics("flipkart", family.flipkartSourceProductId, window),
    computeProductAnalytics("myntra", family.myntraSourceProductId, window),
  ]);

  const ratingComparison = comparePeriods(flipkart.recentMetrics.averageRating ?? 0, myntra.recentMetrics.averageRating ?? 0);

  return {
    available: true,
    familyId,
    flipkartSourceProductId: family.flipkartSourceProductId,
    myntraSourceProductId: family.myntraSourceProductId,
    window,
    flipkart,
    myntra,
    ratingComparison,
  };
}
