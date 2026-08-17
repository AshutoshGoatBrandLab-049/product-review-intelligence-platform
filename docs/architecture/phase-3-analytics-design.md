# Phase 3 — Analytics & Intelligence Data Layer — Architecture Design

**Status: DESIGN ONLY. Nothing in this document has been implemented. No tables created, no migrations written, no code written.** Per instruction, implementation begins only after this design is reviewed and approved.

---

## 1. Existing data model — confirmed by direct inspection, not assumed

Read directly from the live local schema (`\d normalized_reviews`, `pg_indexes`) and the Sequelize model files, not from memory or the earlier architecture docs (which predate several schema changes).

### `normalized_reviews` — the sole analytical source of truth

```
canonical_review_id  CHAR(32)  PK
platform             TEXT      CHECK IN ('flipkart','myntra')
source_product_id    TEXT
source_review_id     TEXT
source_row_id        BIGINT
identity_confidence  TEXT      CHECK IN ('native','derived')
brand                TEXT      nullable
rating                SMALLINT CHECK 1-5
title                 TEXT     nullable
review_text           TEXT     nullable
review_date            DATE     NOT NULL   ← the business date, see §2
review_timestamp        TIMESTAMPTZ nullable  (Myntra only, exact time-of-day)
date_confidence          TEXT   CHECK IN ('exact','day','month')
author                    TEXT  nullable
helpful_count              INTEGER nullable
not_helpful_count           INTEGER nullable
verified_purchase            BOOLEAN nullable  (Flipkart only)
has_images                    BOOLEAN nullable  (Myntra only)
image_urls                     TEXT[]  nullable (Myntra only)
size_purchased                  TEXT   nullable (Myntra only)
color_purchased                  TEXT  nullable (Myntra only)
country                            TEXT nullable
product_url                         TEXT nullable
content_hash                         CHAR(64)
source_updated_at                     TIMESTAMPTZ NOT NULL  ← NEVER use for business logic
source_extra                           JSONB nullable
mapper_version                          INTEGER
ingested_at / created_at / updated_at    TIMESTAMPTZ

UNIQUE (platform, source_product_id, source_review_id)
INDEX (platform, source_product_id)
INDEX (review_date)
```

**Confirmed absent — will not be assumed or invented:**
- **No `category` field anywhere.** Product-level analytics can only group by `(platform, source_product_id)`; there is no product taxonomy. If category analytics are wanted later, that requires a new, explicitly-approved data source or mapping — out of scope here.
- **No reliable reviewer identity.** `author` is free-text (e.g. "Ravi K") sourced directly from the marketplace display name — not a stable ID. Two different real people can share a display name; the same person can appear under slightly different text across reviews. "Unique reviewers" is therefore **not a trustworthy metric** — see §5.
- **No cross-platform product mapping.** `source_product_id` is platform-internal (Flipkart `pid` string, Myntra integer `product_id`) with no shared namespace. Per your explicit instruction (§7), this design never fabricates one.

### `ingestion_watermarks`, `identity_anomalies`, `ingestion_rejects`

Already fully understood from Phase 1/2/2.1 work — no changes needed for Phase 3. Relevant to analytics only as **data-quality inputs** (§20): `ingestion_rejects` tells us what was excluded and why; `identity_anomalies` flags canonical reviews whose identity may be unstable (relevant to confidence, §14).

### Canonical identity & content hash (unchanged, reused as-is)

`canonical_review_id = SHA-256(platform, sourceProductId, sourceReviewId)` — the natural key for "one review, counted once," which is exactly the guarantee analytics needs (§21). `content_hash` is how Track B knows a review changed — analytics needs the *consequence* of that (a changed `updated_at` on the normalized row), not the hash itself.

---

## 2. Business date rule — centralized module

**Absolute, as instructed: `review_date` only. Never `updated_at`, `source_updated_at`, `created_at`, or `ingested_at` for any business-period calculation.**

Centralized in one new module, `src/modules/analytics/dateWindows.ts`, so no other file ever constructs a date-window boundary by hand:

```ts
export type NamedWindow = "7d" | "30d" | "60d" | "90d" | "6m" | "12m";

export interface DateWindow {
  start: string; // YYYY-MM-DD, inclusive
  end: string;   // YYYY-MM-DD, inclusive
}

export function resolveNamedWindow(window: NamedWindow, asOf?: string): DateWindow;
export function customWindow(start: string, end: string): DateWindow; // validates start <= end
export function previousEquivalentWindow(window: DateWindow): DateWindow; // §4
```

Every analytics query function takes a `DateWindow`, never a bare number of days — this is the single chokepoint requested in §2 ("do not duplicate date-window logic throughout the codebase"). `asOf` defaults to `CURRENT_DATE` but is an explicit parameter (not `new Date()` buried inside), so tests can pin it deterministically instead of depending on wall-clock time — the exact bug class that made Phase 1's Flipkart date-confidence heuristic hard to test cleanly.

---

## 3. Time windows

`resolveNamedWindow` supports exactly the 6 named windows requested (7/30/60/90 days, 6/12 months) plus arbitrary custom ranges via `customWindow`. Adding a 7th named window later is a one-line addition to the `NamedWindow` union and a switch arm — never a rewrite, satisfying "must allow future periods without rewriting the analytics engine."

Month-based windows (6m/12m) use calendar-month arithmetic (`setUTCMonth`), not `days * 30`, since that drifts — documented explicitly so a future maintainer doesn't "fix" it into a day-count and silently change every historical comparison's boundary.

---

## 4. Period comparison

**Comparison rule (documented, not implicit):** the previous period is the immediately preceding window of **identical length**, ending the day before the current window starts. Example, matching yours exactly:

```
current:  2026-07-14 → 2026-08-12   (30 days)
previous: 2026-06-14 → 2026-07-13   (30 days, immediately prior, same length)
```

This is the only comparison rule Phase 3 implements. "Previous 90-day period" and "historical baseline" are the *same function* called with a different `DateWindow` — not separate code paths — so there is exactly one comparison implementation to get right, not several with subtly different edge-case behavior.

```ts
export interface PeriodComparison {
  current: number;
  previous: number;
  absoluteDelta: number;
  percentageDelta: number | null; // null, never Infinity/NaN — see below
}

export function comparePeriods(current: number, previous: number): PeriodComparison;
```

**Divide-by-zero rule, explicit:** if `previous === 0`:
- `current === 0` → `percentageDelta: 0` (no change, both empty)
- `current > 0` → `percentageDelta: null` — represented as "insufficient prior data," never `Infinity`. Every consumer (report text, future dashboard) must handle `null` explicitly, not coerce it.

---

## 5. Core review metrics — with documented confidence per metric

All computed from `normalized_reviews` only (never `ingestion_rejects`, which by definition isn't a valid review).

| Metric | Reliable? | Note |
|---|---|---|
| total reviews | Yes | `COUNT(*)` within window |
| average rating | Yes | `AVG(rating)`, always populated (`rating` is `NOT NULL`) |
| rating distribution (1–5 counts + %) | Yes | Direct `GROUP BY rating` |
| 1★–5★ percentage | Yes | Derived from distribution |
| positive % (4–5★) / negative % (1–2★) | Yes | Documented threshold: 3★ is neutral, excluded from both — stated explicitly so it's not silently ambiguous |
| review velocity (reviews/day within window) | Yes | `count / window_length_days` |
| unique products | Yes | `COUNT(DISTINCT source_product_id)` per platform (never combined across platforms — §7) |
| unique reviewers | **NOT IMPLEMENTED — unreliable** | `author` is free text, not an identity (see §1). Reported only as "unique author strings," clearly labeled as an upper-bound-only, low-confidence proxy, never presented as "unique people" |

---

## 6. Rating trend

Daily and weekly grain, both backed by the same `product_daily_metrics` aggregate table (§17) — weekly is a `SUM` rollup over 7 daily rows, not a separately maintained series.

```ts
export interface TrendPoint {
  date: string;
  reviewCount: number;
  averageRating: number | null; // null if reviewCount === 0 for that point — never fabricated
  ratingDistribution: Record<1|2|3|4|5, number>;
  confidence: "sufficient" | "insufficient_data"; // §14
}
```

A day/week with zero reviews is returned as a real point with `reviewCount: 0, averageRating: null`, not omitted — omitting silently would let a gap in the data masquerade as "no change," which is the opposite of what §6 asks ("do not smooth away real changes").

---

## 7. Product-level analytics

Grain: `(platform, source_product_id)` — never merged across platforms, per your explicit instruction. Computed metrics: review count, average rating, rating distribution, recent (window) count/average, historical (pre-window) average, rating delta (via `comparePeriods`), review velocity, negative-review %, trend direction (`improving` / `declining` / `stable` / `insufficient_data` — see §14 for the sample-size gate on this classification).

**Trend direction is deterministic and threshold-based, not a guess:** `declining` if `percentageDelta <= -X%` AND both periods meet the minimum-sample-size gate (§14); `improving` if `>= +X%`; otherwise `stable`. The exact `X` is a configurable threshold (§14), not hardcoded silently.

---

## 8. Brand-level analytics

**Data-quality issue found and designed around, not hidden:** `brand` is stored per-review, not per-product — nothing guarantees every review of the same `source_product_id` has an identical `brand` string (upstream data entry drift is plausible). Design response:
- A `product_dimension` table (§17) records **one** brand per product, deterministically: the brand value from the review with the latest `review_date` (ties broken by `source_row_id DESC`).
- A `brand_inconsistent` flag is set on `product_dimension` if more than one distinct non-null `brand` value was observed for that product — surfaced as a data-quality signal (§20), not silently resolved and hidden.
- Brand rollups then `SUM` `product_daily_metrics` joined through `product_dimension.brand` — never a fresh scan of raw `normalized_reviews.brand` per query.

Combined-platform brand view is a `SUM` across both platforms' rows for that brand — still fully traceable back to which platform each contributing row came from (§9), never presented as if it came from one undifferentiated source.

---

## 9. Platform analytics

Flipkart, Myntra, and combined are three query variants of the same underlying `product_daily_metrics` rollup (`WHERE platform = 'flipkart'`, `= 'myntra'`, or no filter). The `platform` column is retained on every aggregate row precisely so "combined" is always computable as a `SUM`, never a separate, independently-maintained combined table that could drift from its parts.

---

## 10. Sentiment foundation (schema/interfaces only — no LLM, no scoring logic)

```ts
export type SentimentLabel = "positive" | "neutral" | "negative";

export interface ReviewSentiment {
  canonicalReviewId: string;       // FK to normalized_reviews — never copies review text
  label: SentimentLabel;
  confidence: number;              // 0-1
  modelVersion: string;            // e.g. "sentiment-v0" — tracked from day one
  classifiedAt: Date;
  contentHashAtClassification: string; // detects staleness if the review later changes (Track B)
}
```

**Design decisions, made now so the eventual AI integration has a stable contract to build against:**
- **Storage:** a new table `review_sentiment` (1 row per `canonical_review_id`, not embedded in `normalized_reviews` — keeps the AI-derived layer separate from the deterministic ingestion layer, so re-running/re-versioning sentiment never touches ingestion data).
- **Sync vs batch:** **batch**, not synchronous. Reviews arrive via daily Track A/B batches already; sentiment classification should run as its own downstream batch step, not inline in the ingestion path — keeps the "AI never computes numbers during ingestion" boundary from the original architecture intact.
- **Model/version tracking:** `modelVersion` on every row — required, never optional — so a future model upgrade can be measured against the old one rather than silently overwriting history.
- **Staleness/reprocessing:** `contentHashAtClassification` compared against the review's *current* `content_hash` is how a future job detects "this review changed since it was classified" and needs reclassification — reuses the exact mechanism Track B already uses for change detection, not a new one.
- **Nothing here computes a sentiment value in Phase 3.** The table and interfaces exist so Phase 4+ has a clear target, not because classification runs now.

---

## 11. Theme / complaint foundation (schema/interfaces only)

```ts
export interface ReviewTheme {
  canonicalReviewId: string;
  theme: string;              // from a controlled vocabulary, not free text — see below
  evidenceSnippet: string | null; // short, bounded excerpt, not full review text duplication
  confidence: number;
  modelVersion: string;
  extractedAt: Date;
  contentHashAtExtraction: string; // same staleness pattern as §10
}

export const THEME_VOCABULARY = [
  "quality", "size", "fit", "comfort", "color", "durability",
  "packaging", "delivery", "value", "material", "product_mismatch",
] as const;
```

A **controlled vocabulary**, not free-form tags — every theme claim is checkable against a fixed list, and every row is traceable to one `canonical_review_id` (never a bare aggregate count invented without evidence, per §11's "every future theme must be traceable to actual review evidence"). `evidenceSnippet` is deliberately bounded/short — a pointer for a human/AI narrator to find the relevant sentence, not a duplicate copy of the review body (which already lives in `normalized_reviews.review_text`).

Theme *aggregation* (e.g. "38% of negative Product X reviews mention delivery") is a `COUNT` over `review_theme` joined to `normalized_reviews` within a date window — no new aggregate table needed at this volume; revisit only if measurement (§23) shows it's slow.

**Nothing here extracts a theme in Phase 3.**

---

## 12. Severity foundation (schema/interfaces only)

```ts
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SeverityAssessment {
  scopeType: "product" | "brand";
  scopeId: string;              // source_product_id or brand string
  platform: string | null;      // null only for a combined-platform brand assessment
  level: SeverityLevel;
  confidence: "high" | "medium" | "low" | "insufficient_data"; // §14
  inputs: {
    negativeReviewRate: number;
    ratingTrendDelta: number | null;
    complaintFrequency: number | null;  // depends on §11 existing — null until theme extraction runs
    sampleSize: number;
  };
  evidenceReviewIds: string[];   // canonical_review_id[], bounded count, not "all of them"
  computedAt: Date;
  formulaVersion: string;
}
```

**No severity formula is chosen in Phase 3.** The interface separates **FACT** (`inputs` — deterministic, already-computable numbers) from **INTERPRETATION** (`level` — a business judgment call about what counts as HIGH vs CRITICAL, which the instruction explicitly says not to invent). `formulaVersion` exists so that whenever a real formula is approved, its output is comparable across versions rather than silently replacing history.

---

## 13. Product health score — configurable, versioned, not a final formula

Structure, per your example:

```ts
export interface HealthScore {
  scopeType: "product";
  platform: string;
  sourceProductId: string;
  ratingScore: number;
  sentimentScore: number | null;     // null until §10 is implemented
  complaintScore: number | null;     // null until §11 is implemented
  severityScore: number | null;      // null until §12 is implemented
  trendScore: number;
  totalScore: number | null;         // null if any required component is null — never a partial score presented as complete
  version: string;                   // e.g. "health-v0-hypothesis"
  weights: Record<"rating"|"sentiment"|"complaint"|"severity"|"trend", number>;
  computedAt: Date;
}
```

The Phase 2 weights (rating 30 / sentiment 25 / complaint 20 / severity 15 / trend 10) are carried forward **only as the `weights` default for `version: "health-v0-hypothesis"`** — explicitly labeled as a hypothesis, not silently treated as approved, exactly as instructed. Because `sentimentScore`/`complaintScore`/`severityScore` all depend on Phase 4+ work (§10–12), **`totalScore` cannot be computed in Phase 3** — only `ratingScore` and `trendScore` are computable now, from deterministic data already in `normalized_reviews`. The engine is being designed now; it does not fully run yet, and will not silently produce a fake total by re-weighting only the available components.

---

## 14. Sample size & confidence — explicit thresholds, configurable

```ts
export const CONFIDENCE_THRESHOLDS = {
  minReviewsForHighConfidence: 100,
  minReviewsForMediumConfidence: 20,
  minReviewsForLowConfidence: 5,
  // fewer than minReviewsForLowConfidence => "insufficient_data"
} as const;

export function classifyConfidence(sampleSize: number): "high" | "medium" | "low" | "insufficient_data";
```

**These numbers are a starting proposal, explicitly not business-validated** — flagged exactly per your instruction ("if thresholds are not yet business-approved: make them configurable"). They live in one named, exported constant specifically so they can be tuned without touching calculation logic, and every metric that depends on sample size (trend direction, severity, health score) must carry its `confidence` alongside the number — never a bare number presented without it.

---

## 15. Early warning signals (design only — no notification/alert delivery)

```ts
export type SignalType =
  | "sudden_rating_decline"
  | "sudden_negative_review_increase"
  | "complaint_spike"        // depends on §11
  | "review_volume_spike"
  | "persistent_negative_trend"
  | "product_deterioration";

export interface EarlyWarningSignal {
  signalType: SignalType;
  severity: SeverityLevel;      // §12
  detectedDate: string;
  platform: string;
  sourceProductId: string;
  currentMetric: number;
  baselineMetric: number;
  delta: number;
  threshold: number;            // the configured trigger value, always recorded — never implicit
  evidenceReviewIds: string[];
  confidence: "high" | "medium" | "low" | "insufficient_data";
}

export function detectSignals(window: DateWindow, thresholds: SignalThresholds): EarlyWarningSignal[];
```

Every signal is fully self-describing (what fired, against what threshold, with what evidence) so a later consumer never has to reverse-engineer why it fired. `complaint_spike` and `product_deterioration` (which likely needs theme/severity input) will initially return `insufficient_data` until §11/§12 exist — not silently skipped, not fabricated. **No delivery mechanism (email, Slack, webhook) is built in Phase 3**, exactly as instructed.

---

## 16. Evidence model

```ts
export interface EvidenceReference {
  canonicalReviewIds: string[]; // bounded — see below
  totalMatchingCount: number;   // may exceed canonicalReviewIds.length
  platform: string;
  dateWindow: DateWindow;
  query: string;                // human-readable description of what was matched, for audit
}
```

Every analytical claim that references specific reviews (a rating decline, a theme frequency, a severity input) carries an `EvidenceReference` — `canonicalReviewIds`, not review text, per your instruction. `canonicalReviewIds` is **capped** (e.g. 20) with `totalMatchingCount` carrying the true count — avoids an unbounded array on a product with thousands of matching reviews, while `totalMatchingCount` keeps the claim fully auditable (a human can re-run `query`'s described filter and get the same total).

---

## 17. Aggregation strategy

**Chosen: precomputed daily-grain summary tables (application-owned), full-rebuild on each ingestion cycle — not Postgres materialized views, not row-level triggers, not a caching layer.**

Evaluated against the six options requested:

| Option | Verdict | Why |
|---|---|---|
| A. Materialized views | Rejected | Postgres has no true incremental refresh — `REFRESH MATERIALIZED VIEW` always fully recomputes, same cost as a rebuild but with less control over what's rebuilt and worse observability (no natural place to record rebuild duration/row counts) |
| B. Summary tables | **Chosen** | Plain tables give full control: explicit rebuild function, explicit refresh log, indexable independently, extensible without touching a view definition |
| C. Daily aggregates | **Chosen as the grain** | `product_daily_metrics` at `(platform, source_product_id, review_date)` grain — see below |
| D. Incremental aggregation | Rejected for Phase 3 | Given the daily batch cadence (crawlers run once/day, Track A/B run once/day), incremental bump-on-write adds real correctness risk (must handle inserts *and* Track B's rare updates *and* stay in sync) for a freshness benefit nobody needs at daily cadence. Revisit only if a future near-real-time requirement appears. |
| E. Caching | Deferred | A caching layer sits in front of an API that doesn't exist yet (Phase 3 explicitly excludes API work) — irrelevant until Phase 4+ |
| F. Precomputed product metrics | **Chosen** | This *is* `product_dimension` + `product_daily_metrics` |

**Why daily grain specifically:** every requested rollup — 7/30/60/90-day windows, 6/12-month windows, custom ranges, product/brand/platform/combined — is a `SUM` over a contiguous slice of `product_daily_metrics` rows. One precomputed table serves every window and every dimension combination, rather than a combinatorial explosion of separately-maintained tables (a "last-30-days" table, a "last-90-days" table, etc. — explicitly avoided).

**Refresh strategy:** a `rebuildProductDailyMetrics()` function, triggered explicitly by the operator (or eventually a post-ingestion hook — not built in Phase 3) after Track A + Track B complete. It **fully recomputes** `product_daily_metrics` and `product_dimension` from `normalized_reviews` via `GROUP BY`, inside a transaction, replacing the prior contents atomically (`TRUNCATE` + `INSERT ... SELECT`, or a swap table — decided at implementation time based on measured duration, §23). Full rebuild, not incremental, specifically **because**:
- **Late-arriving reviews** (Track A finds new rows any day) are handled automatically — they're just part of the next full `GROUP BY`, no special "insert into aggregate" path to get wrong.
- **Changed reviews** (Track B updates content/rating) are handled identically — the row's *current* state is what gets grouped, no diffing/delta logic needed.
- **Correctness over speed**, matching this project's whole ingestion design philosophy (Track B recomputes `content_hash` from current state rather than tracking deltas) — the same principle applied one layer up.
- **Deleted reviews**: not currently possible (`normalized_reviews` has no delete path — Track A/B only insert/update) — noted as "not applicable, not overlooked."

**Historical recalculation** (e.g. after a health-score formula version change) is the *same* rebuild function, since it's always a full recompute from source — there is no separate "backfill" code path to maintain.

---

## 18. Latest-30-day optimization

The primary use case is directly served by `product_daily_metrics`'s `review_date` column with a new index (`(review_date)` and `(platform, source_product_id, review_date)`), created via a local migration — **never** touching `DataWarehouse.flipkart_reviews`/`myntra_reviews`. A "last 30 days" query becomes a bounded-row-count `SUM` over `product_daily_metrics WHERE review_date >= ...` — at most `30 × (distinct products active that month)` rows, not a scan of the full `normalized_reviews` table regardless of its eventual size (1M+ or more). This is the concrete mechanism that makes §17's "don't scan millions of rows per dashboard request" true, not just a stated goal.

---

## 19. Late / updated reviews

Directly addressed by §17's full-rebuild strategy: since `product_daily_metrics` is always recomputed from `normalized_reviews`'s *current* state, there is no "invalidation" step to design separately — staleness is bounded by "how recently did the rebuild last run," which is recorded (§17) and reported as part of every analytics result's freshness, not hidden. `review_date` is always used for which daily bucket a review lands in — reconfirmed here, not re-derived — so a review with an old `review_date` and a freshly-bumped `source_updated_at` (the exact Phase 1/2 scenario) still lands in its original historical bucket after a rebuild, never in "today."

---

## 20. Data quality reporting

A `computeDataQualityReport(window)` function surfaces, per platform:
- rows in `normalized_reviews` within window (the analyzable set)
- rows in `ingestion_rejects` within a comparable window, by `reason` (already deduplicated per Phase 2.1 — see completenessAudit.ts, reused here rather than reimplemented)
- rows in `identity_anomalies` within window (identity-instability signal)
- products flagged `brand_inconsistent` (§8)
- any product/brand whose sample size is below `CONFIDENCE_THRESHOLDS.minReviewsForLowConfidence` (§14) — reported as excluded-from-high-confidence-claims, never silently dropped from the dataset entirely

Nothing is ever silently excluded from a raw count — only from *confidence-gated interpretations* (trend direction, severity, health score), and always with the reason attached.

---

## 21. No double counting — verification approach

`canonical_review_id` is the primary key of `normalized_reviews` — one row per canonical review is already a hard database guarantee, not just an application convention. `product_daily_metrics` is built via `GROUP BY (platform, source_product_id, review_date)` over that same table, so it inherits the guarantee structurally. Verification for Phase 3 testing (§22) means proving the *rebuild* doesn't introduce double-counting across the specific scenarios you listed (Track A then Track B, repeated Track B, content update, rating update, cross-platform same IDs) — each becomes a test that ingests via the real pipeline, rebuilds, and asserts `SUM(product_daily_metrics.review_count) == COUNT(normalized_reviews)` for the affected scope.

---

## 22. Test plan (implementation phase, not run yet)

Against the existing 100K local dataset (not destroyed) plus small tagged controlled fixtures (same pattern established in Phase 2/2.1 — e.g. `PHASE3CTRL` product IDs), covering exactly the list in your §22/§28: platform/brand/product/date-window/trend/comparison/insufficient-data levels, plus the specific double-counting scenarios above, plus zero-previous-period, plus the change-detection scenarios (updatedAt-only / content / rating changes must correctly move a review's contribution in the rebuilt aggregate, never duplicate it).

---

## 23. Performance (measured at implementation time, not projected here)

Will report, per your §23: execution time, rows scanned, query plan (`EXPLAIN ANALYZE`), index usage, and rebuild duration — measured against the real 100K dataset, explicitly labeled "measured at 100K rows" wherever a number is reported, with any claim about 1M+ behavior explicitly labeled "projected, not measured" and derived by extrapolation, never asserted as tested.

---

## 24–26. Safety, migrations, non-goals

Unchanged from every prior phase's absolute rules, reconfirmed rather than restated as new: local-only, zero production access, `DataWarehouse.*` never modified, all new tables/indexes via local migrations through the existing (unmodified, still-absolute) `assertLocalMigrationTarget` guard, no `ALLOW_REMOTE_APP_MIGRATIONS`-style bypass introduced. No API, no frontend, no LLM calls — this document defines the *shape* of the future AI boundary (§10–12) without crossing it.

---

## Open questions requiring your decision before implementation

These are the specific points where I made a documented default rather than guessing silently — flagging them explicitly rather than burying the choice:

1. **Confidence thresholds** (§14): 100/20/5 reviews for high/medium/low confidence — a starting proposal, not validated.
2. **Positive/negative rating split** (§5): 4–5★ positive, 1–2★ negative, 3★ neutral-and-excluded from both — a common convention, not confirmed as your intended one.
3. **Trend direction threshold** (§7): the `X%` delta that classifies "improving"/"declining" is not yet numerically fixed — needs a value.
4. **Health score `version` naming and whether a partial score (rating+trend only) should be exposed at all in Phase 3**, or whether `totalScore: null` should suppress the whole record until sentiment/complaint/severity exist.
5. **Rebuild trigger mechanism**: manual script invocation only for Phase 3, or should it auto-run at the end of `runIngestion.ts`? (Leaning manual for Phase 3, to keep ingestion and analytics failure domains separate — but flagging rather than deciding unilaterally.)

---

**Stopping here per instruction. Awaiting your review and explicit approval before any implementation begins.**
