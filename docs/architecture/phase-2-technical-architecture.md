# Product Review Intelligence Platform — Technical Architecture Document

**Phase 2 · Design Only · Not for Implementation**

The complete data model, processing design, AI architecture, API surface, and implementation roadmap for the Product Review Intelligence Platform — built entirely on top of Phase 1 discovery, without a single write against production data.

- Prepared: 2026-08-11
- Status: awaiting approval
- Production DB: not modified
- No tables created

---

## Table of Contents

1. [Architecture Decision Summary](#1-architecture-decision-summary)
2. [Data Architecture](#2-data-architecture)
3. [Unified Review Model](#3-unified-review-model)
4. [Identity Strategy](#4-identity-strategy)
5. [Date/Time Strategy](#5-datetime-strategy)
6. [Data Quality Strategy](#6-data-quality-strategy)
7. [Intelligence Data Model](#7-intelligence-data-model)
8. [Processing Pipeline](#8-processing-pipeline)
9. [Incremental Processing](#9-incremental-processing)
10. [Product Health Score](#10-product-health-score)
11. [Problem Detection](#11-problem-detection)
12. [Root Cause Architecture](#12-root-cause-architecture)
13. [AI Architecture](#13-ai-architecture)
14. [Evidence Architecture](#14-evidence-architecture)
15. [Marketplace Comparison](#15-marketplace-comparison)
16. [Early Warning System](#16-early-warning-system)
17. [Backend Architecture](#17-backend-architecture)
18. [API Architecture](#18-api-architecture)
19. [Frontend Architecture](#19-frontend-architecture)
20. [Scalability](#20-scalability)
21. [Security](#21-security)
22. [Observability](#22-observability)
23. [Testing](#23-testing)
24. [Implementation Roadmap](#24-implementation-roadmap)
25. [Risks](#25-risks)
26. [Decisions Required From You](#26-decisions-required-from-you)

---

## 1. Architecture Decision Summary

Six decisions anchor everything that follows:

- **Identity is composite, not a bare ID.** `review_id` is never trusted alone — the canonical key is `(platform, source_product_id, source_review_id)`, deterministically hashed into a single `canonical_review_id`, with an explicit `identity_confidence` flag that stays lower for Flipkart than Myntra forever (§4).
- **Confidence is a first-class field, not an afterthought.** Date confidence, identity confidence, and sample-size confidence travel with every number the platform produces, all the way to the dashboard — the platform never presents an uncertain figure as if it were exact (§5, §10).
- **Storage is three zones, physically separate from production.** Normalized (canonical reviews) → Intelligence (per-review annotations) → Serving (precomputed daily aggregates). Production tables are read, never joined-into-writably, never migrated (§2, §7).
- **Every number on the dashboard is deterministic.** AI never computes a count, percentage, rate, or score — it narrates, clusters, and hypothesizes over numbers the platform already computed (§10, §13).
- **Every AI claim is a resolved citation, not a paraphrase.** An insight without a validated evidence review ID is not shown (§14).
- **Cross-marketplace product comparison is deliberately deferred to brand-level.** Flipkart `pid` and Myntra `product_id` share no join key today; forcing a product-level mapping without one would mean guessing (§15).

---

## 2. Data Architecture

```
Production Raw Reviews          flipkart_reviews · myntra_reviews  (DataWarehouse schema, RDS)
                             │  READ-ONLY ROLE · SELECT ONLY · watermarked on updatedAt
                             ▼
Read-Only Data Access       modules/ingestion/{flipkart,myntra}  — one reader per platform
                             ▼
Normalization                canonical mapper — pure function, deterministic, unit-tested
                             ▼
Validation                   data quality layer — reject / quarantine / flag, never guess (§6)
                             ▼
Unified Review Representation normalized_reviews  — platform-owned store, own schema/DB
                             ▼
Intelligence Processing      review_intelligence — sentiment · themes · complaints (§7)
                             ▼
Aggregations / Metrics       product_metrics_daily · theme_metrics_daily — deterministic, batch
                             ▼
Product Health                product_health_scores — versioned formula (§10)
                             ▼
AI Analysis                   ai_insights — evidence-bound narrative (§13, §14)
                             ▼
Backend API                   indexed reads over precomputed tables only
                             ▼
Frontend Dashboard
```

| Zone | Where it lives | What's computed here | What's cached/precomputed |
|---|---|---|---|
| Source | Existing RDS, `DataWarehouse` schema — untouched | Nothing — read only | N/A |
| Normalized | New schema/DB, owned by this platform | Field mapping, validation, identity hashing | The normalized rows themselves are the durable artifact — this *is* the precomputed unified view |
| Intelligence | Same platform-owned store | Sentiment/theme/complaint classification, cached by content hash | Per-review annotations, recomputed only when review content changes |
| Serving/aggregate | Same platform-owned store | Rollups, health scores, trends, early warnings | Everything — this is what the API actually reads |
| AI/insight | Same platform-owned store | Narrative synthesis over the serving zone's numbers | Cached by input hash, refreshed on a schedule or on meaningful change |

---

## 3. Unified Review Model

| Field | Type | Common / Marketplace-specific | Notes |
|---|---|---|---|
| `canonical_review_id` | string (deterministic hash) | Common — synthetic | PK. Derived from `platform:source_product_id:source_review_id`, not a random UUID — regenerating it from the same source row always yields the same value, which is what makes ingestion idempotent (§9). |
| `platform` | enum(flipkart, myntra) | Common | |
| `source_review_id` | string | Common | Raw ID as stored in the source table (Flipkart's synthetic hash, or Myntra's native id). |
| `source_product_id` | string | Common | Flipkart `pid` as-is; Myntra `product_id` cast to string. Namespaced by `platform` — the two are never compared directly (§4). |
| `identity_confidence` | enum(native, derived) | Common | `native` for Myntra, `derived` for Flipkart. See §4. |
| `brand`, `rating`, `title`, `review_text`, `author`, `country`, `product_url` | — | Common | `title` will always be null for Myntra rows — that's a real data fact, not a mapping bug. |
| `review_date` | date | Common | Always populated. The field every window/trend filter uses (§5). |
| `review_timestamp` | timestamptz, nullable | Common field, Myntra-only value | Null for all Flipkart rows — never backfilled with a guessed time. |
| `date_confidence` | enum(exact, day, month) | Common | See §5. |
| `helpful_count` | int, nullable | Common field | Meaningful for Myntra; carried through for Flipkart but is structurally always 0 there (UI limitation upstream, not a signal). |
| `verified_purchase` | boolean, nullable | **Flipkart-only** | Null (not false) for Myntra — distinguishes "no" from "not applicable." |
| `not_helpful_count`, `has_images`, `image_urls`, `size_purchased`, `color_purchased` | — | **Myntra-only** | Null for Flipkart. Kept as real typed columns (see design note below), not discarded. |
| `source_updated_at` | timestamptz | Common, internal | Copy of the production row's `updatedAt` — the ingestion watermark cursor (§9). Not user-facing. |
| `source_extra` | jsonb | Common, escape hatch | Catch-all for any source field not yet promoted to a typed column — protects against silent data loss if either crawler's schema drifts before this platform's mapper is updated. |

> **Design note:** Marketplace-specific fields are modeled as real nullable columns on `normalized_reviews`, not folded into JSON — there are only five of them, they're stable, and keeping them typed and indexable is worth the sparse-column cost. `source_extra` exists specifically so a future schema change in either crawler doesn't silently disappear before this platform's mapper catches up.

---

## 4. Identity Strategy

`review_id` is never assumed globally unique, and it is never assumed equally trustworthy across platforms. The identity model has three layers:

1. **Composite natural key:** `(platform, source_product_id, source_review_id)` — the true uniqueness boundary, matching each source table's own unique constraint.
2. **Deterministic surrogate key:** `canonical_review_id = hash(platform || ':' || source_product_id || ':' || source_review_id)` — used as the primary key everywhere in this platform's own store, including as the citation unit for AI evidence (§14). Deterministic (not a random UUID) so re-ingesting the same source row always resolves to the same row here — this is what makes upserts idempotent without a lookup table.
3. **Trust flag:** `identity_confidence` — `native` for Myntra (the marketplace's own ID), `derived` for Flipkart (a SHA-1 hash the crawler computes because Flipkart's HTML exposes no real review ID). This flag is not cosmetic — it changes behavior downstream:
   - AI evidence bundles (§13) annotate `derived` citations so the model (and the UI) can appropriately caveat them.
   - The normalization layer diffs incoming content against the previously stored row sharing a `canonical_review_id`; if the text/rating/author materially differ, that's a symptom of a Flipkart hash collision (two distinct reviews sharing author+day+rating+title). It is logged to `identity_anomalies` (§7) for observability — it is *not* silently overwritten without a trace, even though the upsert itself must still proceed (this platform can't recover data Flipkart's own crawler already overwrote upstream).

> **Not verified:** The real-world collision rate for Flipkart's synthetic `review_id` is unknown until live data exists. `identity_anomalies` is exactly the instrument that will measure it once ingestion runs.

---

## 5. Date/Time Strategy

| Field | Flipkart | Myntra |
|---|---|---|
| Source review date | Relative text ("2 weeks ago"), parsed once at scrape time | Millisecond epoch from API, exact |
| Canonical `review_date` | Always populated — reconstructed absolute date | Always populated |
| Canonical `review_timestamp` | **Always null** — no time-of-day exists in the source | Populated — true timestamptz |
| `date_confidence` | `day` if the relative age was in days/weeks at scrape time; `month` if it was in months/years (anchored to the 1st of that month) | Always `exact` |

> **A subtlety worth stating plainly:** `date_confidence` is fixed permanently at the moment a review is first scraped — it does not improve with time. A Flipkart review that was "3 days ago" when first crawled keeps `day` confidence forever, even a year later; one that was "4 months ago" at first crawl keeps `month` confidence forever. This means the accuracy of the 30-day window's date data is coupled to **how promptly the Flipkart crawler reaches a product after a review is posted** — a crawl-cadence dependency this platform does not control (the crawlers are separate projects, per this brief). Crawl frequency and backlog size are **NOT VERIFIED** here.

### Effect on analysis windows

- **Timezone:** both crawlers compute "now" assuming the process runs with `TZ=Asia/Kolkata`. This platform's window boundaries (30-day, 90-day, etc.) must use the same IST calendar-day boundary, or a review near midnight IST could fall on the wrong side of a window compared to how the source data was actually bucketed when scraped.
- **30-day window:** the primary analysis window filters on `review_date` (date-level, not timestamp) — this is the finest resolution usable uniformly across both platforms, since Flipkart has no time-of-day at all.
- **Previous-period comparison:** always adjacent, equal-length windows (e.g. `[today-30, today)` vs `[today-60, today-30)`) computed with identical boundary logic on both sides, so a comparison is never accidentally comparing a 29-day window to a 31-day one.
- **90-day / 6-month / 1-year windows:** increasingly likely to include Flipkart reviews with `month`-level confidence. Historical trend charts must visually distinguish day-precision segments from month-precision segments rather than rendering a uniformly smooth line that implies false precision.
- **Sub-day analysis** (e.g. time-of-day patterns) is only ever valid on Myntra data, and only when explicitly scoped to `platform = 'myntra'` — it is never offered as a cross-platform capability.

---

## 6. Data Quality Strategy

Guiding rule: **quarantine, never delete; flag, never guess.** Source tables are never touched regardless of what validation finds.

| Check | Action | Rationale |
|---|---|---|
| Missing product ID | Hard reject → `ingestion_rejects` | No usable identity without it; both source columns are NOT NULL today, so this guards against future schema drift. |
| Missing review ID | Hard reject → `ingestion_rejects` | Same — defensive against drift, not an expected case today. |
| Missing rating | Hard reject → `ingestion_rejects` | Nearly every downstream metric depends on it; also NOT NULL upstream today. |
| Invalid rating (outside 1–5) | Hard reject, flagged for investigation | Signals possible upstream corruption, worth a human look, not just a silent drop. |
| Missing review text | **Not rejected** — passes through | Rating-only reviews are a legitimate, common state on both platforms. Downstream sentiment/theme classification is skipped for that row, not the ingestion. |
| Invalid/unparseable date (including future dates, or before ~2007) | Hard reject → `ingestion_rejects` | A guessed date would silently corrupt every trend/window calculation that touches it — better to lose the row visibly than trust a bad date invisibly. |
| Duplicate source review (same natural key seen twice) | Not an error — idempotent upsert by `canonical_review_id` | Expected and normal under incremental/backfill re-runs (§9). |
| Identity collision (Flipkart content drift under same key) | Upsert proceeds; logged to `identity_anomalies` | See §4 — cannot be "fixed" here, only surfaced. |
| Invalid marketplace value | Hard reject, treated as a programming-error alert | This value is set by the reader itself, not by source data — seeing an invalid one means a bug, not bad data. |
| Missing/invalid brand | Ingest normally; flag `brand_missing=true`; excluded from brand-level rollups only | Brand is denormalized metadata, not review identity — the review itself is still real and usable at the product level. |
| Product mapping not found (orphaned `source_product_id`) | Ingest normally; flag `product_mapping_missing=true` | Neither source table has an FK between reviews and products anyway (Phase 1 finding) — this is expected friction, surfaced via observability (§22), not a reason to drop real review data. |

---

## 7. Intelligence Data Model

Platform-owned entities. No tables are created in this phase — this is the design those future migrations will implement.

### `normalized_reviews`
- **Purpose:** Canonical, validated, deduplicated review — the single input every downstream stage reads.
- **PK:** `canonical_review_id`
- **Unique key:** `(platform, source_product_id, source_review_id)`
- **Key fields:** All of §3's unified model.
- **Relationships:** Many-to-one `products` (via platform + source_product_id, no FK upstream so this join is application-enforced); one-to-one `review_intelligence`.
- **Source:** Ingestion pipeline.
- **Refresh:** Incremental upsert, watermarked.
- **Retention:** Full — mirrors source retention, never purged automatically.

### `products`
- **Purpose:** Lightweight platform-scoped product dimension, derived from reviews themselves (not copied from the crawlers' product tables, since no FK connects them anyway).
- **PK:** `platform_product_key` (`platform` + `source_product_id`)
- **Unique key:** Same as PK
- **Key fields:** `brand` (most-recently-seen), `first_seen_at`, `last_seen_at`, `review_count` (cached)
- **Relationships:** One-to-many `normalized_reviews`
- **Source:** Rolled up from `normalized_reviews` as it's ingested
- **Refresh:** Incremental, on every new review for that product
- **Retention:** Permanent

### `review_intelligence`
- **Purpose:** Per-review sentiment, theme, and complaint annotations.
- **PK:** `canonical_review_id` (1:1 with `normalized_reviews`)
- **Key fields:** `sentiment_label`, `sentiment_score`, `content_hash`, `model_version`, `processing_status`, `processed_at`
- **Relationships:** Many-to-many `themes` via `review_themes`
- **Source:** Deterministic rules + AI classification (§11, §13)
- **Refresh:** Only when `content_hash` changes — idempotent skip otherwise
- **Retention:** Full, tied to the review's own lifetime

### `themes` + `review_themes` junction
- **Purpose:** Extensible, controlled problem/theme taxonomy (§11) — data, not a hardcoded enum.
- **PK:** `theme_id`; junction PK `(canonical_review_id, theme_id)`
- **Unique key:** `theme_slug`
- **Key fields:** `label`, `category_group` (product-quality / marketplace-fulfillment / value / listing-accuracy), `active`; junction adds `confidence_score`, `is_complaint`, `severity`
- **Source:** Seeded taxonomy + AI-proposed candidates (human-promoted, §11)
- **Refresh:** Taxonomy: append-only, rare changes. Junction: rewritten when a review is reprocessed.
- **Retention:** Permanent

### `product_metrics_daily`
- **Purpose:** Deterministic daily rollup per product — the base unit every dashboard read composes from.
- **PK:** `(platform_product_key, metric_date)`
- **Key fields:** `review_count`, `avg_rating`, `rating_distribution`, `positive_pct`/`negative_pct`/`neutral_pct`, `complaint_count`, `verified_purchase_pct` (Flipkart only, nullable)
- **Relationships:** Many-to-one `products`
- **Source:** Aggregation job over `normalized_reviews` + `review_intelligence`
- **Refresh:** Nightly full pass + intraday incremental for "today"
- **Retention:** Full 1yr+ history — cheap, since row count is products × days, not products × reviews

### `theme_metrics_daily`
- **Purpose:** Per-product, per-theme daily frequency and severity.
- **PK:** `(platform_product_key, theme_id, metric_date)`
- **Key fields:** `mention_count`, `complaint_count`, `avg_severity`, `sentiment_mix`
- **Source:** Aggregation over `review_themes`
- **Refresh:** Nightly + incremental
- **Retention:** Full history

### `marketplace_metrics_daily`
- **Purpose:** Platform-level (Flipkart vs Myntra) rollups per brand for cross-marketplace comparison (§15).
- **PK:** `(platform, brand, metric_date)` day-one; extends to `product_family_key` once mapping exists
- **Key fields:** Same shape as `product_metrics_daily`, scoped per platform
- **Source:** Aggregation
- **Refresh:** Nightly + incremental
- **Retention:** Full history

### `product_health_scores`
- **Purpose:** Versioned composite health score per product per day (§10).
- **PK:** `(platform_product_key, score_date, formula_version)`
- **Key fields:** `score` (0–100), `category`, `input_snapshot` (jsonb — the exact inputs used, for explainability), `confidence`, `sample_size`
- **Source:** Health scoring job over `product_metrics_daily` + `theme_metrics_daily` + trend data
- **Refresh:** Nightly + incremental
- **Retention:** Full history — needed for the health trend chart

### `trend_snapshots`
- **Purpose:** Precomputed period-over-period comparisons (§8).
- **PK:** `(platform_product_key, window_type, computed_for_date)`
- **Key fields:** `rating_change`, `sentiment_change`, `complaint_change`, `volume_change`, `severity_change`, `direction`, `confidence`
- **Source:** Computed over `product_metrics_daily` / `theme_metrics_daily`
- **Refresh:** Nightly
- **Retention:** Daily granularity for 90 days; downsample to weekly beyond that (later optimization, not day one)

### `early_warning_signals`
- **Purpose:** Rule-evaluated deterministic early-warning entries (§16).
- **PK:** `signal_id` (uuid)
- **Unique key:** `(platform_product_key, signal_type, window_start)` — prevents duplicate alerts for the same condition
- **Key fields:** `severity`, `triggered_at`, `metrics_snapshot`, `resolved_at`, `status`
- **Source:** Rule engine over `trend_snapshots` + `theme_metrics_daily`
- **Refresh:** Nightly evaluation
- **Retention:** Kept for audit trail, including resolved signals

### `ai_insights`
- **Purpose:** Cached AI narrative (summary / root cause / recommendation) with resolved evidence (§13, §14).
- **PK:** `insight_id` (uuid)
- **Unique key:** `(platform_product_key, insight_type, period_key, input_hash)` — makes regeneration cache-aware
- **Key fields:** `content` (structured jsonb), `evidence_review_ids[]`, `confidence`, `priority`, `model_version`
- **Relationships:** `evidence_review_ids` reference `normalized_reviews.canonical_review_id`, validated to exist at write time
- **Source:** AI layer
- **Refresh:** On `input_hash` change, or a max-age schedule (e.g. weekly) to catch prompt/model improvements
- **Retention:** Last N versions kept per product for audit/comparison; superseded versions archived, not deleted

### `ingestion_watermarks` / `ingestion_rejects` / `identity_anomalies`
- **Purpose:** Pipeline bookkeeping — incremental cursor, quarantined rows, and identity-drift log (§4, §6, §9).
- **PK:** `platform` / `reject_id` / `anomaly_id` respectively
- **Source:** Ingestion + validation + normalization layers
- **Refresh:** Every run (watermark); append/upsert (rejects); append-only (anomalies)
- **Retention:** Watermark: current state only. Rejects: rolling ~90 days, sufficient for debugging. Anomalies: permanent — low volume, high diagnostic value.

---

## 8. Processing Pipeline

Two entry points share one normalization/validation code path — only the read-cursor strategy differs.

### Initial backfill
One-time, chunked keyset pagination over each source table (batches of ~5,000–10,000 rows ordered by primary key `id`, which is indexed on both sources — no new index requested on production). Each chunk is normalized, validated, and upserted independently; the watermark advances after every successfully committed chunk, not just at the end, so a crash mid-backfill resumes rather than restarts.

### Incremental processing
Scheduled job queries `WHERE updatedAt > last_watermark ORDER BY updatedAt, id` (composite cursor — the tie-break on `id` matters, since many rows can share an `updatedAt` after a bulk upsert on the crawler side). Processed in the same chunk size as backfill.

---

## 9. Incremental Processing

| Concern | Approach |
|---|---|
| New review detection | Watermark on production `updatedAt`, per platform, stored in `ingestion_watermarks`. |
| Already-processed detection | Deterministic `canonical_review_id` (§4) — no separate lookup table needed; an upsert against an existing key is a no-op update, not a duplicate insert. |
| Idempotency | Guaranteed by the deterministic ID + `ON CONFLICT DO UPDATE` upsert — reprocessing the same source row any number of times converges to the same state. |
| Checkpointing | Watermark advances only after a batch's upsert commits successfully — never optimistically. |
| Retry | Exponential backoff per batch, mirroring the pattern already used in both crawler repos (a convention worth keeping, not reinventing). |
| Failure recovery | Transient failure (connection drop): watermark does not advance, next run retries the same window. Structural failure (mapper bug): alert fires (§22), watermark deliberately withheld rather than silently skipping data. |
| Reprocessing | Scoped by `formula_version` / `model_version` fields already in the schema (§7) — old outputs aren't deleted when a scoring formula or taxonomy changes; new versions compute alongside, the API serves the latest. A full reprocessing run is its own chunked backfill-style job, never triggered implicitly by the incremental path. |
| Data freshness | Exposed directly from `ingestion_watermarks` on an observability endpoint (§22) — never assumed. |
| Backfill support | Same mapper/validator code as incremental; only the read-cursor strategy (full chunked scan vs watermark filter) differs. |

---

## 10. Product Health Score

Five weighted components, each normalized to 0–100 before weighting:

| Component | Weight | What it captures | Why this weight |
|---|---|---|---|
| Rating | 0.30 | Average rating over the window, normalized | Still the most recognizable, most business-trusted signal — anchors the score to something stakeholders already understand. |
| Sentiment | 0.25 | Net positive-minus-negative sentiment from text | Catches nuance rating alone misses — e.g. a 3-star review with genuinely severe complaint text. |
| Complaint frequency | 0.20 | Complaints per 100 reviews | Operationalizes "how often" — one of the platform's core questions (Phase 1, Q7). |
| Complaint severity | 0.15 | Average severity of active complaints | Operationalizes "how bad" separately from "how often" — a rare severe complaint shouldn't be invisible next to many mild ones. |
| Trend modifier | 0.10, bounded ±10 pts | Recent trajectory (improving/declining) | Rewards/penalizes direction without letting a single bad week crater an otherwise long-healthy product — deliberately capped. |

> **Requires user decision:** These weights are a starting hypothesis, not a validated constant. They're stored as a versioned, configurable `formula_version` — never hardcoded — specifically so they can be reviewed against known-good and known-bad products once real data exists, and recomputed historically under a new weight set without discarding the old scores for comparison.

### Score range, categories, confidence

- **Range:** 0–100, each component clipped to [0,100] before weighting so an outlier can't break the scale.
- **Categories** (illustrative, configurable): 80–100 Excellent · 65–79 Good · 45–64 Needs Attention · 25–44 At Risk · 0–24 Critical.
- **Minimum sample-size threshold:** below 10 reviews in the window, a score is still computed but flagged `confidence='low'` — never hidden, since "too little data" is itself informative, but never presented as precise either. 10–30 reviews → `medium`; 30+ → `high`. **Requires user decision** on final thresholds once real volume distribution is known.

---

## 11. Problem Detection

The theme taxonomy is **data, not code** — the `themes` table (§7), not a hardcoded enum — so new categories never require a deployment. Seeded initial taxonomy: size/fit, material, quality, color, durability, delivery, packaging, value-for-money, returns/refund, expectation-mismatch, customer-service — each tagged with a `category_group` (Product Quality / Marketplace-Fulfillment / Value / Listing-Accuracy) that directly feeds the product-vs-marketplace classification in §15.

Classification is hybrid: deterministic keyword/pattern rules handle high-precision obvious cases fast and cheaply; AI classification handles nuanced or ambiguous text, but is constrained to select from the *current active theme list* — plus an explicit "propose new theme" path. Proposals are routed to a `theme_candidates` queue for human promotion rather than auto-creating production themes from unsupervised AI output, which would otherwise let the taxonomy drift into duplicate near-identical categories over time.

---

## 12. Root Cause Architecture

```
Problem            theme + severity crosses a deterministic threshold
     │
Observation       deterministic pattern, e.g. "sizing complaints up 40% over 30d, concentrated on Myntra"
     │
Evidence          top 8–15 review IDs + quotes, ranked by relevance/severity, always with canonical_review_id attached
     │
Root Cause        AI-generated hypothesis, given only the Observation + Evidence — never raw DB access
Hypothesis
     │
Business Impact   deterministic estimate: affected review volume, trend direction
     │
Recommended       AI-generated, tied explicitly to the hypothesis above it
Action
```

Certainty is gated deterministically, not by the model's own confidence claims: root cause is only ever labeled *established* when evidence crosses an explicit bar — e.g. the theme appears in ≥ a set share of negative reviews, is consistent across a minimum review count, and is stable or growing over at least two consecutive windows. Below that bar, output is always presented as a *hypothesis* with an attached confidence tier. The model is prompted to only use certainty language the upstream confidence field allows, and output is checked post-hoc (§13) — the model cannot unilaterally escalate "hypothesis" to "confirmed."

---

## 13. AI Architecture

```
Metrics + Themes + Trends + Selected Reviews + Product Context
                          │
                         AI
                          │
                  Structured Output  (summary · problems[] · root_cause_hypothesis ·
                                       business_impact · recommendation · confidence)
                          │
                     Validation      (schema check · citation check · certainty-language check)
                          │
                    Stored Insight   (ai_insights, with resolved evidence, §14)
```

The input bundle is always pre-filtered, ranked, and bounded (≤ ~25 reviews, capped token budget) — never a raw dump of a product's reviews. Every number the model is given (counts, percentages, trend deltas) is pre-computed by the deterministic layer and injected as structured data; the system prompt instructs the model to narrate only the numbers it's given, never to compute or estimate its own.

### Anti-hallucination controls

- Every `evidence_review_ids` entry in the output is validated post-hoc: must exist in `normalized_reviews`, must belong to the claimed product, and must have actually been part of the input evidence bundle — not merely any real ID, which would let the model swap in a plausible-but-wrong citation.
- Output is schema-constrained (structured/tool-call output); a response that violates the schema or contains an invalid citation is rejected and retried, bounded to a small number of attempts, then logged and suppressed rather than shown malformed.
- Certainty language is lint-checked against the deterministic confidence tier from §12 — words like "confirmed" or "proven" are rejected when the tier is `hypothesis`/low.
- Flipkart-sourced evidence is explicitly annotated `identity_confidence=derived` in the input bundle so the model can caveat that specific piece of evidence appropriately.
- An insight with zero valid evidence citations for a concrete claim is never surfaced — it's regenerated or suppressed with a logged reason (§14).

### Cost and scale controls

- Per-review classification cached by `content_hash` — a review is sent to the model once, ever, unless its text changes.
- Classification is batched (tens of reviews per call), never one-call-per-review.
- A smaller/cheaper model handles high-volume per-review classification; a stronger model is reserved for the low-volume synthesis calls (summary, root cause, recommendation).
- All calls are queued and rate-limited so a backlog (e.g. onboarding a new brand) degrades gracefully instead of spiking cost.

---

## 14. Evidence Architecture

```
AI conclusion
     │
evidence_review_ids[]        stored on the insight, resolved at read time (never baked into stored text)
     │
join on canonical_review_id  →  normalized_reviews
     │
     ├── source_review_id
     ├── marketplace (platform)
     ├── product (platform_product_key, brand)
     ├── review_date  (+ date_confidence)
     └── review_text  (+ title)
```

Every insight API response includes a fully-resolved `evidence[]` array — the frontend never has to guess or make a second round-trip. If an evidence ID somehow fails to resolve at read time (shouldn't happen given write-time validation, but handled defensively), it's dropped from the response and logged as an anomaly, never shown as a broken reference. Structurally, every AI-surfaced claim in the dashboard is paired with a "view evidence" affordance; an insight without resolvable evidence for its claims isn't rendered as an AI insight at all (§19's shared `EvidenceDrawer` component enforces this everywhere AI output appears, not per-page).

---

## 15. Marketplace Comparison

> **Requires user decision:** Flipkart `pid` and Myntra `product_id` are unrelated identifier spaces — there is no existing key that says "this Flipkart listing and this Myntra listing are the same physical product." Three options: (a) a manually curated mapping table, business-provided — most reliable; (b) fuzzy matching on brand + title/attributes — heuristic, would need its own confidence scoring; (c) defer product-level mapping and compare at brand-level only until a mapping exists. **Recommended: (c) for day one** — see below.

Brand-level and theme-level comparison need no product mapping at all — `brand_name` exists on both sources today, so "Brand X's sizing complaints are 3× more frequent on Myntra than Flipkart" is answerable immediately and already satisfies most of Phase 1's Q9/Q10 in practice. True product-level comparison is deferred behind an explicit, separately-approved `product_family_mapping` table.

### Product-level vs. marketplace-level classification

Given a theme showing elevated frequency for a brand, the system compares relative frequency/severity/sentiment for that theme across platforms:

- **Product-level (cross-marketplace consistent):** theme appears at comparable relative frequency on both platforms (within a configured ratio band) *and* both sides meet the minimum sample-size threshold.
- **Marketplace-specific:** frequency is skewed beyond that ratio band, with adequate sample size on the smaller side too — ruling out "just didn't have enough reviews yet" as the explanation.
- **Insufficient evidence:** either platform lacks the minimum sample size — the system says so explicitly rather than defaulting to a "product-level" guess, per this brief's explicit instruction not to auto-classify.

---

## 16. Early Warning System

All signals are deterministic and rule-based — consistent with "AI is not the source of truth" — and every threshold below is a starting configuration, versioned like the health score formula, pending validation against real historical variance.

| Signal | Condition |
|---|---|
| Negative sentiment acceleration | Week-over-week negative-sentiment % increase past a threshold, sustained ≥ 2 consecutive periods (avoids single-week noise). |
| Complaint acceleration | `theme_metrics_daily` complaint-count growth rate over trailing windows crosses a threshold. |
| Rating decline (pre-bucket-change) | Rating/trend slope negative over ≥14 days while the health category is still "Good"/"Excellent" — precisely the "healthy today, deteriorating underneath" case this system exists to catch. |
| Theme growth | A previously low-frequency theme rapidly gaining share of total complaints. |
| Severity growth | Average severity of an existing theme increasing even while frequency stays flat. |
| Review volume change | Sudden spike or drop — treated partly as its own signal, partly as a confidence caveat on every other signal computed in the same window. |

Noise avoidance: sustained trend required across ≥2 consecutive evaluation windows, minimum sample size per window (reusing §10's confidence-tier concept), and de-duplication via `early_warning_signals`'s unique key so an already-open signal doesn't re-fire every night — only on resolution-then-recurrence or meaningful escalation.

---

## 17. Backend Architecture

```
backend/src/
  config/                    env validation (zod), per-connection config
  database/
    prodReadOnly/            connection setup — ONLY place holding read-only prod credentials
    appStore/                connection setup for the platform's own writable schema/DB
  modules/
    ingestion/
      flipkart/  myntra/     per-platform readers
      shared/                canonical model types, mapper interface, validators, id hashing
    reviews/                 query interface over normalized_reviews (internal, not routed raw)
    products/                product dimension + rankings composition
    intelligence/
      themes/                taxonomy management
      (sentiment/theme/complaint classification orchestration)
    metrics/                 aggregation jobs + read services
    health/                  health score formula + versioning
    trends/                  trend/comparison computation
    earlyWarning/            rule engine
    rootCause/                observation/evidence assembly (feeds ai/)
    ai/                       LLM client, prompts, evidence bundling, output validation — the ONLY module calling an LLM
    insights/                 ai_insights orchestration (calls ai + rootCause + evidence resolution)
    marketplaceComparison/
    dashboard/                 per-page API composition, thin
  jobs/                       scheduler wiring invoking module job entrypoints
  api/                        express routers, versioned, thin controllers
  shared/                     logger, error types, cache client, evidence-resolution helper
  utils/                      date/tz helpers (IST convention), canonical-id hashing
  constants/                  theme taxonomy seed reference, enums
```

| Module | Responsibility | Layers present | Deliberately absent |
|---|---|---|---|
| `ingestion` | Read prod, normalize, validate, watermark | Repository (reader), Service (mapper/validator), Domain (canonical model) | No Controller — triggered by jobs, not HTTP. |
| `reviews` | Internal query interface over normalized reviews | Repository, Service | No Controller, no DTO beyond the canonical model itself. |
| `products` | Product dimension + rankings | Repository, Service, Controller (rankings endpoint), DTO | — |
| `intelligence` | Sentiment/theme/complaint classification orchestration | Service, Domain (rules), Validator | No Repository of its own — writes via `reviews`/`metrics` services. |
| `metrics` | Deterministic aggregation, single source of truth for numbers | Repository, Service (job + read) | No Controller — read access goes through `dashboard`. |
| `health` | Formula implementation, versioned | Service (pure formula), Repository | No Controller, no Validator beyond input-shape checks — this is math, not user input. |
| `trends` | Period comparisons | Service, Repository | No Controller. |
| `earlyWarning` | Rule engine | Service (rules), Repository, Controller (ack/resolve endpoint) | — |
| `rootCause` | Observation + evidence assembly | Service, Domain | No Repository — reads via `metrics`/`reviews`, no Controller. |
| `ai` | LLM client, prompts, output validation | Service, Validator (schema + citation) | No Repository, no Controller — a pure integration layer other modules call into. |
| `insights` | ai_insights lifecycle | Repository, Service, Controller, DTO | — |
| `marketplaceComparison` | Brand/product cross-platform comparison | Service, Repository, Controller | — |
| `dashboard` | Per-page composition | Controller, DTO (page-shaped responses) | No Repository, no Domain logic of its own — pure composition. |

---

## 18. API Architecture

| Method / Path | Purpose | Data source | Caching / precomputation |
|---|---|---|---|
| `GET /v1/dashboard/executive?window=` | Org-wide summary, top movers, active alert count | `product_metrics_daily` + `product_health_scores` + `early_warning_signals` | Precomputed rows; short-TTL response cache (aggregates across all products) |
| `GET /v1/products/rankings?window=&sort=&platform=&brand=&page=` | Sortable/filterable product list | `product_health_scores` ⋈ `product_metrics_daily` | Precomputed, server-driven sort/filter, paginated |
| `GET /v1/products/:key` | Full product detail bundle | `product_metrics_daily`, `product_health_scores` (series), `theme_metrics_daily`, latest `ai_insights` | Precomputed reads; optional short-TTL cache per product |
| `GET /v1/products/:key/health?window=` | Health score time series | `product_health_scores` | Precomputed |
| `GET /v1/problems?window=&theme=&platform=&minSeverity=` | Cross-product complaint clustering | `theme_metrics_daily` aggregated | Precomputed daily |
| `GET /v1/products/:key/trends?window=` · `GET /v1/trends/overview` | Per-product and cross-product trend leaderboard | `trend_snapshots` | Precomputed nightly |
| `GET /v1/products/compare?brand=&theme=` | Brand-level Flipkart vs Myntra comparison (day one) | `marketplace_metrics_daily` | Precomputed |
| `GET /v1/products/:key/marketplace-comparison` | Product-level comparison — *gated behind §15's mapping decision* | `marketplace_metrics_daily` + `product_family_mapping` | Precomputed, feature-flagged |
| `GET /v1/products/:key/insights?type=` | Latest AI summary / root cause / recommendation, with resolved evidence | `ai_insights` + evidence join | Cached by `input_hash` |
| `POST /v1/products/:key/insights/regenerate` | Trigger regeneration (queued, not synchronous) | `ai` module | N/A — write path; requires user decision on who can call this |
| `GET /v1/recommendations/priority` | Cross-product actioned worklist | `ai_insights` type=recommendation | Precomputed/cached |
| `GET /v1/early-warnings?status=&severity=` | Open/resolved warning feed | `early_warning_signals` | Precomputed |
| `PATCH /v1/early-warnings/:id` | Acknowledge/resolve a warning | `early_warning_signals` (platform-owned store only) | N/A — write path, auth-gated |
| `POST /v1/analyst/query { question, scope }` | Conversational AI Product Analyst | Retrieval over precomputed intelligence + bounded evidence | **Live, no cache** — rate-limited instead |
| `GET /v1/system/ingestion-status` · `GET /v1/system/ai-usage` | Internal pipeline/cost observability (§22) | `ingestion_watermarks`, job status tables, AI usage log | Live, admin-only |

---

## 19. Frontend Architecture

| Page | Key components | Data |
|---|---|---|
| Executive Dashboard | `HealthOverviewStrip`, `TopMoversList`, `ActiveAlertsPanel`, `PlatformSplitTile` | `GET /dashboard/executive` |
| Product Rankings | `RankingsTable` (server-driven sort), `FilterBar` | `GET /products/rankings` |
| Product Detail | `ProductHeader`, `HealthTrendChart`, `RatingDistributionChart`, `ThemeBreakdownPanel`, `ComplaintList`, `AIInsightCard` (× summary/root-cause/recommendation) | `GET /products/:key`, `/health`, `/trends`, `/insights` |
| Problems | `ProblemsTable` (theme × severity × frequency), `ThemeDrilldownPanel` | `GET /problems` |
| Trends | `TrendLeaderboard`, `WindowSelector`, `TrendDetailChart` | `GET /trends/overview`, `/products/:key/trends` |
| Marketplace Comparison | `BrandComparisonTable` (day one), `ProductComparisonPanel` (gated) | `GET /products/compare` |
| Early Warnings | `WarningsFeed` (open/resolved tabs), `WarningDetailCard` | `GET /early-warnings`, `PATCH` |
| AI Insights | `InsightsGallery`, each card using the shared `EvidenceDrawer` | `GET /products/:key/insights` |
| AI Product Analyst | `ChatPanel`, `QuerySuggestions`, `AnswerCard` (also uses `EvidenceDrawer`) | `POST /analyst/query` |

**Shared components:** `EvidenceDrawer` (§14's UI contract, centralized in one component so "no unsupported claim" is structural, not per-page discipline), `ConfidenceBadge` (renders date/identity/sample-size confidence consistently everywhere), `HealthCategoryPill`, `SeverityStripe`, `PlatformBadge`.

---

## 20. Scalability

- **Query strategy:** every dashboard read hits precomputed tables sized products × days, not products × reviews, indexed on `(platform_product_key, metric_date/window_type)`.
- **Index recommendations apply only to new platform-owned tables** — production `flipkart_reviews`/`myntra_reviews` indexes are never touched, per the absolute rule restated at the top of this phase.
- **Aggregation:** nightly full pass for correctness + intraday incremental upsert of only "today's" row for freshness — cost is bounded regardless of total historical volume.
- **Precomputation:** the only live reads against raw review data are point lookups by `canonical_review_id` (evidence resolution) and the Analyst's bounded retrieval — never a full-table aggregate.
- **Caching:** short-TTL response cache in front of the heaviest cross-product endpoints (executive dashboard, rankings, problems).
- **Batch processing:** ingestion in chunks of ~5–10k rows; AI classification in batches of tens of reviews per call — never single-row-at-a-time for bulk work.
- **Pagination:** every list endpoint is offset/limit or cursor paginated, hard-capped max page size.
- **AI context limits:** evidence bundles hard-capped (≤ ~25 reviews, bounded token budget); the aggregation layer absorbs scale, not the AI call.
- **Path to 10M+:** partition `normalized_reviews`/`review_intelligence` by month (`review_date`); derived aggregate tables stay small regardless since they're keyed by product×day; consider read replicas of the platform's own store if API load grows independent of ingestion load; scope nightly full-recompute to products with actual new activity once "recompute everything nightly" stops being cheap.

---

## 21. Security

> **Documented, not executed.** Exact grants a DBA would run — not run here, per the stop condition:

```sql
GRANT CONNECT ON DATABASE gbl_data_lake TO review_intel_ro;
GRANT USAGE ON SCHEMA "DataWarehouse" TO review_intel_ro;
GRANT SELECT ON
  "DataWarehouse".flipkart_reviews,
  "DataWarehouse".myntra_reviews,
  "DataWarehouse".flipkart_review_pid,
  "DataWarehouse".flipkart_review_brand,
  "DataWarehouse".myntra_review_pid
TO review_intel_ro;
-- No INSERT / UPDATE / DELETE / TRUNCATE / DDL grants of any kind, ever.
```

- **Own-store credentials** are a fully separate role — read/write, but scoped only to this platform's schema, with zero grants on `DataWarehouse`.
- **Secrets:** `backend/.env.example` (currently empty) should document variable names only — `DB_PROD_*` (read-only role), `DB_APP_*` (own store), `AI_PROVIDER_API_KEY`, `CACHE_URL`, `NODE_ENV`, `PORT`, `LOG_LEVEL`. Never committed; dotenv locally, a secrets manager in deployed environments — requires user decision (ties to Phase 1's hosting question).
- **API auth/authz:** shape designed regardless of the open decision — read endpoints need at least session/token auth (internal tool, not public); write endpoints (warning ack, insight regeneration) need a stricter role check since they mutate this platform's operational state.
- **Input validation:** every request validated against a schema before touching a service — path/query params, especially `platform_product_key` and window enums, strictly whitelisted.
- **Rate limiting:** per-IP/per-token on all endpoints; tighter limits specifically on the Analyst endpoint given its cost profile.
- **AI prompt security:** review text is customer-authored and therefore untrusted input flowing into a prompt — confined to clearly delimited "evidence" sections with explicit instructions that it is data to analyze, not instructions to follow; structured output constraints (§13) limit the blast radius of a successful injection to a malformed response that fails validation.

---

## 22. Observability

- **Structured logs:** JSON, correlation/run ID per ingestion batch and per AI generation call.
- **Processing metrics:** rows read/normalized/rejected per run per platform; batch duration; AI calls made, cache-hit rate, tokens, cost per run.
- **Job status:** a status table (mirroring `ingestion_watermarks`) extended to every scheduled job — aggregation, health scoring, early-warning evaluation, AI regeneration — with last-run time, status, duration, error.
- **Failed records:** `ingestion_rejects` and `identity_anomalies` surfaced via an internal panel, not buried in logs alone.
- **Data freshness:** now minus `last_source_updated_at` processed, per platform, alertable against an SLA — the SLA itself is bounded by crawl cadence, which is **NOT VERIFIED** here.
- **AI usage/cost:** per-run and rolling-window token/call counts and estimated cost, broken out by call type (classification vs. synthesis), since their cost profiles differ by orders of magnitude.
- **API latency:** per-route duration histograms, watched closely on the Analyst endpoint.
- **Pipeline health:** one composite view combining watermark freshness + job statuses + rejection-rate trend — a meta-signal for "is the intelligence itself trustworthy right now," distinct from any individual product's health score, worth its own tile on the Executive Dashboard.

---

## 23. Testing

| Layer | Coverage |
|---|---|
| Unit | Normalization mappers, date/confidence logic, canonical-ID hashing, health-score formula across weight configs, theme classification rules, evidence-citation validator. |
| Integration | Ingestion pipeline against a seeded fixture mirroring `DataWarehouse`'s real shape; idempotency test — run ingestion twice, assert identical resulting state. |
| Data quality | One positive + one negative test per §6 rule. |
| Intelligence | Theme/sentiment classification against a hand-labeled golden set. |
| Health scoring | Known input → expected score; weight-config swap test; regression lock per `formula_version`. |
| AI evaluation | Golden-prompt regression set; automated hallucination/citation-validity checks (§13). |
| API | Contract tests per endpoint, including auth and rate-limit behavior. |
| Frontend | Component tests for loading/empty/error states; e2e for the nine golden dashboard paths. |
| Performance / load | Synthetic 1M+ and 10M+ row fixtures, aggregation job timing, API p95 under load. |
| End-to-end | Seed a synthetic raw review → ingest → normalize → classify → aggregate → score → insight → API → verify the full chain. |
| Regression | Locked golden outputs per `formula_version`/`model_version` so a formula change can't silently drift a fixed input's score. |
| Edge cases | Null Myntra `title`, Flipkart `review_id` collision detection, IST midnight boundary reviews, empty `review_text`, minimum-sample-size confidence flagging, cross-platform "insufficient evidence" path, AI schema-validation failure triggering retry not silent failure. |

---

## 24. Implementation Roadmap

### Phase 0 — Approvals & access
- **Objective:** Unblock everything downstream
- **Dependencies:** User decisions on Phase 1 Q1–Q2 and this phase's §26
- **Work:** Hand off §21's exact GRANT statements to a DBA; populate `backend/.env.example` with the agreed variable contract
- **Tests:** Connection smoke test; a deliberate write attempt via the read-only role, proving it's rejected — not just assuming it
- **Completion criteria:** Read-only role connects; a write attempt through it fails with a permission error
- **Risks:** DBA access delay — mitigated by having the exact SQL ready now

### Phase 1 — Read-only ingestion
- **Objective:** Real, validated normalized data flowing from both platforms
- **Modules:** `modules/ingestion/*`
- **Work:** Readers, canonical mapper, validators, ID hashing, backfill + incremental jobs, watermark/reject/anomaly tables
- **Tests:** Unit + integration + idempotency test; a capped/sampled real run against production to resolve Phase 1's §17 NOT VERIFIED items
- **Completion criteria:** Backfill completes within budget; incremental correctly picks up only changed rows; rejection rate within expected bounds
- **Risks:** Real data may violate assumptions read from crawler code — validators must fail loud, never silently coerce

### Phase 2 — Deterministic intelligence base
- **Objective:** Prove the aggregation pipeline shape before adding AI cost/complexity
- **Modules:** `metrics`, `products`, `intelligence/themes` (deterministic rules only, no AI yet)
- **Work:** `product_metrics_daily`/`theme_metrics_daily` jobs, first-pass keyword-rule theme tagging
- **Tests:** Aggregation correctness on fixtures; performance at synthetic 1M-row scale
- **Completion criteria:** Nightly runtime within budget at target scale; metrics match hand-computed fixture values
- **Risks:** Mainly a performance validation gate — low functional risk

### Phase 3 — Health scoring & trends
- **Modules:** `health`, `trends`
- **Work:** Versioned formula implementation, `trend_snapshots`, confidence gating
- **Tests:** Formula unit tests across weight configs; regression lock on a fixed fixture
- **Completion criteria:** Business sign-off on initial weights against a sample of known products — §10's decision, realized here
- **Risks:** Weights are unvalidated until this review happens — do not treat first-pass weights as final

### Phase 4 — AI-assisted intelligence
- **Modules:** `ai`, upgraded `intelligence`, `rootCause`, `insights`
- **Dependencies:** Phases 2–3 stable; AI provider decision (Phase 1 Q3)
- **Work:** AI client, prompts, evidence bundling, output/citation validation, caching by hash
- **Tests:** Golden-set classification eval; hallucination/citation regression suite
- **Completion criteria:** 100% citation validity on the regression suite; cost-per-1000-reviews within an agreed budget
- **Risks:** Cost overrun if caching/batching isn't correct before scaling to the full corpus — this phase should not reprocess everything until cost is validated on a sample

### Phase 5 — Early warning & marketplace comparison
- **Modules:** `earlyWarning`, `marketplaceComparison`
- **Work:** Rule engine, threshold config, brand-level comparison (day one), family-mapping-gated product-level comparison
- **Tests:** Threshold tuning against real historical data, now available
- **Completion criteria:** Acceptable signal-noise rate over a human-reviewed trial period
- **Risks:** Thresholds are genuinely un-tunable without real variance data — expect an iteration after initial deployment

### Phase 6 — API layer
- **Modules:** `api/*`, `dashboard`
- **Work:** §18's endpoint set, auth/rate-limiting per §21 (pending Phase 1 Q6)
- **Tests:** Contract tests, auth/rate-limit tests
- **Completion criteria:** Full endpoint set passing contract tests, matching §19's frontend data requirements

### Phase 7 — Frontend
- **Work:** §19's pages, shared `EvidenceDrawer`/`ConfidenceBadge` built first since every page depends on them
- **Tests:** Component tests, e2e golden paths
- **Completion criteria:** All nine pages functional against real API data, verified in a real browser against golden and empty/edge states

### Phase 8 — Hardening
- **Work:** Full observability wiring (§22), load testing at 1M/10M synthetic scale, security review, documentation finalized
- **Completion criteria:** All Phase 1 §20 readiness gates met

---

## 25. Risks

- Health-score weights and early-warning thresholds are unvalidated hypotheses, stated explicitly rather than hidden behind confident defaults — real business validation is required once real data exists (§10, §16).
- Cross-platform product-level comparison has no existing join key — day-one scope is deliberately brand-level only (§15).
- AI cost scales with corpus size × reprocessing frequency; if hash-based caching isn't correct from day one, cost could scale worse than linearly as review volume grows (§13, Phase 4 gate).
- Crawl cadence and backlog size are outside this platform's control (crawlers are separate projects) — any freshness SLA this platform promises is bounded by facts not yet verified (§5, §22).
- Flipkart's identity and date imprecision are permanent characteristics of that data source, not bugs this platform can fix — they can only be surfaced honestly via the confidence fields threaded through the entire model (§3–§5).

---

## 26. Decisions Required From You

Phase 1's nine open questions (database access path, own-store location, AI provider/budget, caching infra, job scheduler, dashboard access control, frontend framework, hosting target, future-marketplace scope) all remain open. This phase adds five more:

- **Q10 — Health score formula weights.** Approve §10's starting weights, or provide alternates, before Phase 3 begins.
- **Q11 — Early-warning thresholds.** Approve §16's starting configuration, or defer tuning entirely until Phase 5 when real historical data exists.
- **Q12 — Cross-platform product mapping strategy.** Manual mapping table vs. staying at brand-level comparison indefinitely (§15) — recommend deferring to brand-level for now.
- **Q13 — Who can trigger insight regeneration / acknowledge warnings.** Feeds the role model behind §21's auth design for the two write endpoints in §18.
- **Q14 — Minimum sample-size confidence thresholds.** §10 proposes 10/30 as starting values — needs validation once real review-volume distribution per product is known.

---

*Design only — no application code, database objects, or crawler code were created or modified in the course of this document. Awaiting review before any implementation phase begins.*

*Source: [Phase 2 architecture artifact](https://claude.ai/code/artifact/034ecb11-8309-4e2b-8d03-ae9eb9612062)*
