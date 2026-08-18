/**
 * Phase 7 Step 1 — TypeScript types mirroring the ACTUAL Phase 6 API
 * responses. Every shape here was read directly from the backend source
 * this step (src/api/controllers/*.ts, src/modules/analytics/*.ts,
 * src/modules/ai/narrator.ts) — nothing here is invented, and nullable
 * backend fields stay nullable here (never coerced to a fake 0/[]).
 */

// ── Shared primitives ──────────────────────────────────────────────────────

export type Platform = "flipkart" | "myntra";

export type NamedWindow = "7d" | "30d" | "60d" | "90d" | "6m" | "12m";

export interface DateWindow {
  start: string;
  end: string;
}

/** THEME_VOCABULARY, backend/src/database/appStore/models/reviewTheme.ts */
export const THEME_VOCABULARY = [
  "quality",
  "size",
  "fit",
  "comfort",
  "color",
  "durability",
  "packaging",
  "delivery",
  "value",
  "material",
  "product_mismatch",
] as const;
export type Theme = (typeof THEME_VOCABULARY)[number];

/** analytics/confidence.ts */
export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient_data";

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

/** analytics/coreMetrics.ts */
export interface CoreMetrics {
  totalReviews: number;
  averageRating: number | null;
  ratingDistribution: RatingDistribution;
  ratingPercentages: RatingDistribution;
  positivePercentage: number | null;
  negativePercentage: number | null;
  neutralPercentage: number | null;
  reviewVelocity: number;
  uniqueProducts: number;
  confidence: ConfidenceLevel;
}

/** analytics/periodComparison.ts */
export interface PeriodComparison {
  current: number;
  previous: number;
  absoluteDelta: number;
  percentageDelta: number | null;
}

/** analytics/productAnalytics.ts */
export type TrendDirection = "improving" | "declining" | "stable" | "insufficient_data";

export interface ProductAnalytics {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
  brandInconsistent: boolean;
  recentMetrics: CoreMetrics;
  historicalMetrics: CoreMetrics;
  ratingComparison: PeriodComparison;
  trendDirection: TrendDirection;
}

/** analytics/brandAnalytics.ts */
export interface BrandAnalytics {
  brand: string;
  platform: Platform | "combined";
  productCount: number;
  recentMetrics: CoreMetrics;
  historicalMetrics: CoreMetrics;
  ratingComparison: PeriodComparison;
  trendDirection: TrendDirection;
}

/**
 * analytics/healthScore.ts — severityScore and totalScore are ALWAYS null
 * (no approved formula exists, Phase 4 §19). Never rendered as 0.
 */
export interface HealthScore {
  scopeType: "product";
  platform: Platform;
  sourceProductId: string;
  ratingScore: number;
  sentimentScore: number | null;
  complaintScore: number | null;
  severityScore: null;
  trendScore: number;
  totalScore: null;
  version: "health-v0-hypothesis";
  weights: {
    rating: number;
    sentiment: number;
    complaint: number;
    severity: number;
    trend: number;
  };
  computedAt: string;
}

// ── Early warning ───────────────────────────────────────────────────────────

/** analytics/earlyWarning.ts */
export type SignalType =
  | "sudden_rating_decline"
  | "sudden_negative_review_increase"
  | "complaint_spike"
  | "review_volume_spike"
  | "persistent_negative_trend"
  | "product_deterioration";

export interface EarlyWarningSignal {
  signalType: SignalType;
  detectedDate: string;
  platform: Platform;
  sourceProductId: string;
  currentMetric: number;
  baselineMetric: number;
  delta: number;
  threshold: number;
  evidenceReviewIds: string[];
  /** "not_ready" is a real, permanent state for product_deterioration, and
   * the default state for complaint_spike when no threshold is supplied —
   * never render this as a fired signal. */
  confidence: ConfidenceLevel | "not_ready";
}

// ── Marketplace comparison ──────────────────────────────────────────────────

/** analytics/marketplaceComparison.ts */
export type ThemeConsistencyClassification = "marketplace_consistent" | "marketplace_specific" | "insufficient_evidence";

export interface ThemeConsistencyResult {
  theme: string;
  flipkartFrequencyPercent: number | null;
  myntraFrequencyPercent: number | null;
  flipkartSampleSize: number;
  myntraSampleSize: number;
  classification: ThemeConsistencyClassification;
}

export interface BrandMarketplaceComparison {
  brand: string;
  window: DateWindow;
  flipkart: BrandAnalytics;
  myntra: BrandAnalytics;
  /** current = flipkart's average rating, previous = myntra's — a
   * platform-vs-platform delta reusing comparePeriods, NOT a time comparison. */
  ratingComparison: PeriodComparison;
  themeConsistency: ThemeConsistencyResult[];
}

/**
 * Discriminated union on `available` — matches compareProductByFamily's
 * real return type exactly. Every real product today returns the
 * `available: false, reason: "no_mapping"` branch (product_family_mapping
 * is empty everywhere, Phase 5/6) — this is the expected default state,
 * not an error, and must be designed for as a first-class UI state.
 */
export type ProductMarketplaceComparison =
  | {
      available: true;
      familyId: string;
      flipkartSourceProductId: string;
      myntraSourceProductId: string;
      window: DateWindow;
      flipkart: ProductAnalytics;
      myntra: ProductAnalytics;
      ratingComparison: PeriodComparison;
    }
  | {
      available: false;
      familyId: string;
      reason: "no_mapping";
    };

// ── Problems ────────────────────────────────────────────────────────────────

/** analytics/problemsAggregate.ts — deliberately no severityScore/totalScore field. */
export interface ProblemThemeSummary {
  theme: string;
  mentionCount: number;
  distinctReviewCount: number;
  distinctProductCount: number;
  confidence: ConfidenceLevel;
}

// ── AI narrator ─────────────────────────────────────────────────────────────

/** ai/narrator.ts CITABLE_METRIC_FIELDS */
export type CitableMetricField = "reviewCount" | "averageRating" | "positivePercentage" | "negativePercentage" | "totalMatchingNegativeCount";

export interface NarratorRootCauseEntry {
  theme: Theme;
  explanation: string;
  evidenceReviewIds: string[];
}

export interface NarratorRecommendationEntry {
  reason: string;
  evidenceReviewIds: string[];
  confidence: number;
  theme?: Theme | null;
}

/**
 * ai/narrator.ts NarratorResult — only VALIDATED narrator output ever
 * reaches this shape (schema-checked, citation-validated, numerically
 * grounded — Phase 4/4.1). citedMetrics vs ungroundedMetrics is the
 * single most important AI-trust signal in this system; both must be
 * surfaced, never silently merged.
 */
export interface NarratorResult {
  summary: string;
  rootCause: NarratorRootCauseEntry[];
  recommendations: NarratorRecommendationEntry[];
  rejectedCitations: string[];
  irrelevantCitations: string[];
  droppedUnsupportedClaims: number;
  citedMetrics: Array<{ field: CitableMetricField; statedValue: number }>;
  ungroundedMetrics: Array<{ field: string; statedValue: number; reason: "unknown_field" | "value_mismatch" }>;
}

// ── Review / Evidence ──────────────────────────────────────────────────────

export interface ReviewTheme {
  theme: Theme;
  evidenceSnippet: string | null;
  confidence: number;
  modelVersion: string;
}

export interface ReviewDetail {
  canonicalReviewId: string;
  platform: Platform;
  sourceProductId: string;
  sourceReviewId: string;
  rating: number;
  title: string | null;
  reviewText: string | null;
  author: string | null;
  reviewDate: string;
  reviewTimestamp: string | null;
  dateConfidence: "exact" | "day" | "month";
  helpfulCount: number | null;
  notHelpfulCount: number | null;
  verifiedPurchase: boolean | null;
  hasImages: boolean | null;
  imageUrls: string[] | null;
  sizePurchased: string | null;
  colorPurchased: string | null;
  country: string | null;
  productUrl: string | null;
  brand: string | null;
  identityConfidence: "native" | "derived";
  sentiment: "positive" | "neutral" | "negative" | null;
  sentimentConfidence: number | null;
  sentimentModelVersion: string | null;
  themes: ReviewTheme[];
}

export interface EvidenceReviewsResponse {
  reviews: ReviewDetail[];
  count: number;
}

export interface ProductReviewsResponse {
  reviews: ReviewDetail[];
  count: number;
  totalMatchingCount?: number;
  requestedLimit?: number;
}

export interface ProductAnalystResponse {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  userQuestion: string;
  answer: string;
  /** null for retrieval / clarification responses — those never run the narrator. */
  analysis: NarratorResult | null;
  cacheHit: boolean;
  /** Present only for RETRIEVAL-intent responses — real DB-backed reviews, never AI-invented. */
  reviews?: ReviewDetail[];
  totalMatchingCount?: number;
  requestedLimit?: number;
  needsClarification?: boolean;
  clarificationPrompt?: string;
  multiIntentDetected?: boolean;
  multiIntentNote?: string;
}

export interface ConversationMessage {
  role: "user" | "ai";
  content: string;
  timestamp: string;
  analysis?: NarratorResult;
  intent?: string;
  aspect?: string;
  reviewIds?: string[];
}

export interface ConversationResponse {
  id: string;
  platform: Platform;
  sourceProductId: string;
  windowStart: string;
  windowEnd: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

// ── Endpoint response envelopes (src/api/controllers/*.ts) ─────────────────

export interface ProductDetailResponse {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  analytics: ProductAnalytics;
  health: HealthScore;
}

export interface ProductSignalsResponse {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  signals: EarlyWarningSignal[];
}

export interface ProductInsightsResponse {
  platform: Platform;
  sourceProductId: string;
  window: DateWindow;
  cacheHit: boolean;
  insight: NarratorResult;
}

export interface EarlyWarningsResponse {
  window: DateWindow;
  cacheHit: boolean;
  filters: { platform: Platform | null; brand: string | null };
  productsScanned: number;
  signals: EarlyWarningSignal[];
}

export interface DashboardExecutiveResponse {
  window: DateWindow;
  cacheHit: boolean;
  productCount: number;
  activeAlertCount: number;
  /** null if zero products have a rating — never render as "0". */
  averageRatingScore: number | null;
  topMovers: Array<{ platform: Platform; sourceProductId: string; brand: string | null; health: HealthScore }>;
  bottomMovers: Array<{ platform: Platform; sourceProductId: string; brand: string | null; health: HealthScore }>;
}

export type RankingsSort = "health" | "rating";

export interface RankingsResponseItem {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
  sortValue: number | null;
  data: HealthScore | ProductAnalytics;
}

export interface RankingsResponse {
  window: DateWindow;
  cacheHit: boolean;
  sort: RankingsSort;
  page: number;
  pageSize: number;
  totalCount: number;
  items: RankingsResponseItem[];
}

export interface ProblemsResponse {
  window: DateWindow;
  cacheHit: boolean;
  filters: { platform: Platform | null; theme: Theme | null };
  themes: ProblemThemeSummary[];
}

export interface IngestionWatermarkRow {
  platform: Platform;
  /** Postgres BIGINT — the pg driver serializes this as a string, not a
   * number, to avoid precision loss beyond Number.MAX_SAFE_INTEGER.
   * Confirmed against the real API response, not assumed (Phase 7 Step 9). */
  last_seen_source_id: string;
  last_reconciliation_run_at: string | null;
  last_reconciliation_rows_scanned: number | null;
  last_reconciliation_rows_changed: number | null;
  status: "idle" | "running";
  lock_acquired_at: string | null;
  updated_at: string;
}

export interface IngestionStatusResponse {
  watermarks: IngestionWatermarkRow[];
}

export interface AiProcessingRunRow {
  id: string;
  job_id: string;
  platform: Platform | null;
  provider: string;
  model_version: string;
  dry_run: boolean;
  candidate_count: number;
  already_classified_count: number;
  stale_count: number;
  new_count: number;
  processed_count: number;
  success_count: number;
  failure_count: number;
  retry_count: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: "running" | "success" | "partial_failure" | "failed";
}

export interface AiUsageResponse {
  runs: AiProcessingRunRow[];
}

// ── Error envelope (src/api/middleware/errorHandler.ts) ────────────────────

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present only on ai_* error codes (AiProviderError passthrough). */
    retryable?: boolean;
    retryAfterMs?: number;
  };
}
