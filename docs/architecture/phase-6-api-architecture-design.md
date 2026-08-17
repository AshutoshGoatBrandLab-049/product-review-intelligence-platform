# Phase 6 — API Architecture Design

**Status:** Design only. No routes, controllers, server wiring, database changes, or AI calls exist as a result of this document. Written to reconcile the original Phase 2 API design (`phase-2-technical-architecture.md` §17–19) against what Phases 3–5 actually built, per Step 0's findings.

**Governing principle (restated, and enforced below):** the API is a thin HTTP layer. Every capability below names the exact existing function it calls — nothing here re-derives a calculation that already exists.

---

## 1. Step 1A — Real implementation inventory

Every function actually available today, by capability. File paths are exact; nothing here is inferred or assumed.

### Product analytics

| Capability | Function | File | Notes |
|---|---|---|---|
| Core rating/volume/sentiment-split metrics for a scope (product/brand/platform) | `computeCoreMetrics(filter)` | `analytics/coreMetrics.ts` | Underlies every higher-level function below — not called directly by the API in most cases. |
| Single-product analytics (recent + historical + trend) | `computeProductAnalytics(platform, sourceProductId, window)` | `analytics/productAnalytics.ts` | Returns `ratingComparison`, `trendDirection`, both periods' `CoreMetrics`. |
| Brand analytics, one platform or combined | `computeBrandAnalytics(brand, window, platform?)` | `analytics/brandAnalytics.ts` | |
| Platform-wide analytics | `computePlatformAnalytics(window, platform?)` | `analytics/platformAnalytics.ts` | |
| Health score | `computeHealthScore(platform, sourceProductId, window)` | `analytics/healthScore.ts` | Returns `ratingScore`/`trendScore` (always real), `sentimentScore`/`complaintScore` (real once data exists, else `null`), `severityScore`/`totalScore` (**always `null`** — no approved formula, type-level guarantee). |
| Trend direction | `classifyTrendDirection(...)` (used inside `computeProductAnalytics`) | `analytics/productAnalytics.ts` | Not called standalone by the API — always arrives bundled in `ProductAnalytics`. |
| Evidence (bounded review IDs for a claim) | `findEvidence(query)` | `analytics/evidence.ts` | Caps at 20 IDs + a separate accurate `totalMatchingCount`. |
| Data quality report | `computeDataQualityReport(platform, window, sourceTotal)` | `analytics/dataQuality.ts` | Internal/ops use, not a dashboard-facing number. |
| Confidence classification | `classifyConfidence(...)`, `CONFIDENCE_THRESHOLDS` | `analytics/confidence.ts` | Every metrics object above already carries its own `confidence` field — the API never re-derives this. |
| Date windows | `resolveNamedWindow`, `customWindow`, `previousEquivalentWindow` | `analytics/dateWindows.ts` | The API's `window=` query param maps directly to `resolveNamedWindow`'s `NamedWindow` union — no new window logic. |
| Period comparison | `comparePeriods(current, previous)` | `analytics/periodComparison.ts` | Reused inside several of the above — not called directly by the API. |
| Severity | — | `analytics/severity.ts` | **Types only, zero computation.** No severity number exists anywhere in this codebase. Any endpoint field for severity must be omitted or explicitly `null`, never invented at the API layer. |

### Early warning

| Capability | Function | File | Notes |
|---|---|---|---|
| Single-product signal detection | `detectProductSignals(platform, sourceProductId, window, thresholds?)` | `analytics/earlyWarning.ts` | 5 live signal types + `product_deterioration` always `not_ready`. |
| Catalog-wide sweep | `detectAllProductSignals(window, thresholds?, batchSize?)` | `analytics/earlyWarning.ts` | Keyset-paginated internally; Category C at the API layer (§3). |
| Threshold values | `config.earlyWarning` | `config/index.ts` | The four Step-4-tuned defaults; already env-configurable, nothing new needed. |

### Marketplace comparison

| Capability | Function | File | Notes |
|---|---|---|---|
| Brand-level Flipkart-vs-Myntra | `compareBrandAcrossMarketplaces(brand, window)` | `analytics/marketplaceComparison.ts` | Includes `classifyThemeConsistency` results per theme already. |
| Theme-consistency classification | `classifyThemeConsistency(...)` | `analytics/marketplaceComparison.ts` | Called internally by the function above — not a standalone endpoint. |
| Product-family lookup | `getProductFamily(platform, sourceProductId)` | `analytics/marketplaceComparison.ts` | Returns `null` today for every real product — table is empty (§10 of the Phase 5 report). |
| Product-level comparison (gated) | `compareProductByFamily(familyId, window)` | `analytics/marketplaceComparison.ts` | Returns `{available:false, reason:"no_mapping"}` for every real product today. The API must surface this explicitly, never hide the endpoint or fake a result. |

### AI

| Capability | Function | File | Notes |
|---|---|---|---|
| Deterministic evidence bundle for AI | `buildProductEvidencePackage(platform, sourceProductId, window)` | `ai/evidencePackage.ts` | Pure DB read — no AI call. |
| AI narration + validation | `narrateProductEvidence(evidencePackage, provider)` | `ai/narrator.ts` | **Calls the real configured AI provider synchronously, every time.** Returns `rejectedCitations`, `irrelevantCitations`, `droppedUnsupportedClaims`, `citedMetrics` (verified), `ungroundedMetrics` — all of which the API must pass through, never strip for a "cleaner" response. |
| Provider instantiation | `createAiProvider()` | `ai/providers/providerFactory.ts` | Env-driven (`AI_PROVIDER`) — already exists, no change needed. |
| Batch sentiment/theme pipeline | `runAiSentimentPipeline(options, provider)` | `ai/pipeline.ts` | A **job**, not a request-scoped call — this stays off the API's request path entirely; it's how `review_sentiment`/`review_theme` get populated, run out-of-band (`npm run ai:sentiment` today). |
| Candidate selection for classification | `findCandidateReviews`, `summarizeCandidates` | `ai/candidateSelection.ts` | Same — job-side, not API-facing. |
| Retry/error classification | `classifyGeminiError(err)` | `ai/providers/geminiProvider.ts` | Internal to the provider; the API layer only needs to catch `AiProviderError` and map its `category`/`retryable` fields to an HTTP status — never re-implement retry logic in the API layer. |

**Conclusion of 1A: every deterministic and AI capability Phase 6 needs already exists as a callable function. Nothing in this inventory requires new calculation logic — Phase 6's actual work is HTTP shape, request validation, error mapping, and the Category C strategy below.** The one partial exception is "cross-product problems" (§18's `GET /v1/problems`), which has no existing single function — see §4.

---

## 2. Step 1B — Performance classification

### Category A — cheap live read (compute per request, no caching needed)

Grounded in Phase 3's actual measured number: a single-product `product_daily_metrics` lookup took **0.246ms / 27 buffers** at 100K-row scale (§15 of the Phase 3 report) — **PROVEN BY EXECUTION** at that scale, and structurally bounded regardless of catalog growth since it only ever touches one product's rows.

| Endpoint shape | Reused function(s) |
|---|---|
| Single product detail | `computeProductAnalytics` |
| Single product health | `computeHealthScore` |
| Single product early-warning signals | `detectProductSignals` |
| Single product-family comparison | `compareProductByFamily` (one row lookup + 2× `computeProductAnalytics`) |
| Evidence for a specific claim | `findEvidence` |

### Category B — moderate live computation (bounded, but non-trivial)

| Endpoint shape | Reused function(s) | Why not Category A |
|---|---|---|
| Brand-level marketplace comparison | `compareBrandAcrossMarketplaces` | Bounded to one brand, but real brands in the local dataset carry 2,400–4,400+ reviews per side (Step 8, PROVEN BY EXECUTION) — not a single-row lookup, though still a single indexed aggregate per side, not a catalog loop. No caching required to start; worth latency-checking once real usage exists. |
| Single-product AI insight | `buildProductEvidencePackage` + `narrateProductEvidence` | The DB portion is Category A. The AI portion is a **live network call to Gemini/Anthropic on every request** — moderate not because of DB cost, but because of external-call latency and **per-call cost** (§13's original design assumed caching by `input_hash` specifically to bound this; no such cache exists today — flagged as an open decision in §4). |

### Category C — expensive catalog-wide computation (needs a strategy, not naive per-request looping)

| Endpoint shape | Would require | Why it's Category C |
|---|---|---|
| Executive dashboard | `computeHealthScore`/`computeProductAnalytics` looped over all 1,004+ products | No existing function aggregates across the whole catalog for health/rating — would mean 1,004 sequential (or parallel-batched) calls per request. |
| Product rankings (sortable by health/rating across the whole catalog) | Same loop, plus in-memory sort | Same reason — no indexed cross-product rollup exists to sort against directly. |
| Catalog-wide early warnings | `detectAllProductSignals` | Already loops internally (keyset-paginated) — Step 8 ran it against all 1,004 real products as part of a larger validation script; **exact isolated per-call HTTP latency was NOT MEASURED**, only observed as part of a longer script run. Must not be assumed cheap without a real timing test in Phase 6. |
| Cross-product "problems" (theme × severity × frequency clustering) | New grouped aggregate query (§4) | No existing function returns this shape at all — and severity has no formula (§1), so the "severity" axis from §18's original design cannot be honestly implemented yet. |

**Recommended initial strategy for Category C — to be confirmed with you before Step 2 implements anything:**

The lowest-risk option, given the current architecture, is an **in-process, short-TTL memoization cache** (a plain `Map<key, {value, expiresAt}>` in `src/shared/`, zero new dependency) in front of Category C endpoints only. Reasoning:

- Matches §20 of the original architecture doc's own intent ("short-TTL response cache in front of the heaviest cross-product endpoints") without committing to new infrastructure (Redis, etc.) that nothing in this codebase uses today and that the "caching infra" open question (§26 Q-list) has never been answered.
- Fully reversible — deleting the cache wrapper reverts an endpoint to naive live computation with zero other changes.
- Known limitation, disclosed rather than hidden: an in-process cache does **not** share state across multiple server instances. Since the "hosting target" question is also still open, this is fine for a single-instance deployment and would need revisiting the moment horizontal scaling enters the picture.
- Does **not** reintroduce the precomputed serving-table pattern Phase 3 already deliberately moved away from (§4 covers each specific old table on its own merits — this is a request-layer cache, not a data-layer table).

Not proposing a specific TTL value here — that should come from an actual latency measurement of the catalog sweep taken early in Step 2, the same evidence-before-defaults discipline Phase 5's threshold tuning used, not a guessed number.

---

## 3. Proposed API contract (reconciled with reality)

Reworked from §18 of the original architecture doc. Removed anything with no real data source; added an explicit "reused function" column so nothing here can silently drift into a reimplementation.

| Method / Path | Purpose | Reused function(s) | Category |
|---|---|---|---|
| `GET /v1/products/:platform/:sourceProductId?window=` | Full product detail | `computeProductAnalytics`, `computeHealthScore` | A |
| `GET /v1/products/:platform/:sourceProductId/signals?window=` | Early-warning signals for one product | `detectProductSignals` | A |
| `GET /v1/products/:platform/:sourceProductId/insights?window=` | AI summary/root-cause/recommendations | `buildProductEvidencePackage` + `narrateProductEvidence` | A (DB) / live AI call — see §4's caching decision |
| `GET /v1/brands/:brand/compare?window=` | Brand-level Flipkart vs Myntra | `compareBrandAcrossMarketplaces` | B |
| `GET /v1/products/family/:familyId/compare?window=` | Product-level comparison (gated) | `compareProductByFamily` | A — but **must return `available:false` honestly for every real product today**, since `product_family_mapping` is empty |
| `GET /v1/early-warnings?window=&platform=&brand=` | Catalog-wide open signals | `detectAllProductSignals` | C — needs §2's caching decision |
| `GET /v1/dashboard/executive?window=` | Org-wide summary | Loop over `computeHealthScore`/`computeProductAnalytics` | C |
| `GET /v1/products/rankings?window=&sort=&platform=&brand=&page=` | Sortable product list | Same loop + in-memory sort/paginate | C |
| `GET /v1/problems?window=&theme=` | Cross-product theme clustering | **New** grouped aggregate (§4) — no severity axis until a formula is approved | C |
| `GET /v1/system/ingestion-status` | Pipeline freshness | Direct read of `ingestion_watermarks` (existing table) | A |
| `GET /v1/system/ai-usage` | AI run history | Direct read of `ai_processing_runs` (existing table) | A |

**Deliberately not proposed yet (real, not silently dropped):**

- `PATCH /v1/early-warnings/:id` (ack/resolve) — needs a persistence decision first (§4).
- `POST /v1/products/:key/insights/regenerate` — redundant while insights are uncached (§4); every `GET .../insights` call already "regenerates." Only becomes meaningful once the AI-insight-caching decision is made.
- `POST /v1/analyst/query` (conversational analyst) — **nothing in the current codebase implements retrieval or bounded-evidence-selection for free-form questions.** This is not a thin HTTP wrapper over an existing function like everything else here; it is new product-logic work. Recommend deferring to its own later phase rather than folding it into Phase 6's first cut.

---

## 4. Step 1C — Old-table-by-old-table classification

| Old table | Classification | Reasoning |
|---|---|---|
| `product_metrics_daily` | **KEEP OUT** | A real replacement (`product_daily_metrics`) already exists and is in active use since Phase 3. Recreating the old name would be a confusing duplicate, not a gap to fill. |
| `theme_metrics_daily` | **KEEP OUT FOR NOW** | Phase 3 already evaluated and explicitly rejected this for cost/complexity at current scale. Reconsidering it needs new evidence (a real measured performance problem from the Category C `problems` endpoint), not the old design doc's say-so alone. |
| `marketplace_metrics_daily` | **KEEP OUT FOR NOW** | Phase 5 already made and implemented the equivalent decision — live `compareBrandAcrossMarketplaces` instead. Reopening it would silently reverse an already-approved Phase 5 decision without new cause. |
| `product_health_scores` | **KEEP OUT FOR NOW** | Category A — cheap enough to compute live per the measured single-product-lookup numbers (§2). Persisting a score-history table would also require deciding retention and a `formula_version` policy that was never approved (§26 Q10 is still open) — premature to build storage for an unapproved formula's history. |
| `trend_snapshots` | **KEEP OUT FOR NOW** | Same reasoning as health scores — Category A, cheap, and no new decision is needed to keep it live. |
| `early_warning_signals` | **NEEDS YOUR DECISION — leaning toward a minimal, different table than the original design.** | This is not purely a performance question — `PATCH /v1/early-warnings/:id` requires a **stable ID and persisted acknowledgment state** that a recomputed, unpersisted signal fundamentally cannot provide across calls. Recommend, if you want the ack/resolve endpoint at all: a small **warning-acknowledgment-state** table only (natural key `(platform, source_product_id, signal_type, window_start)` → `status`, `acknowledged_by`, `acknowledged_at`), joined at read time against the live `detectProductSignals`/`detectAllProductSignals` output — not a full daily rollup of signal values themselves. This is a much smaller commitment than the original table and doesn't reintroduce precomputation for the values, only for the mutable ack state that has nowhere else to live. Alternative: descope the ack/resolve endpoint entirely for Phase 6 v1 and ship signals read-only. Both are real options — not deciding this unilaterally. |
| `ai_insights` | **NEEDS YOUR DECISION.** | Currently every insight request is a live, uncached AI call — real cost and latency exposure the moment a UI can trigger requests at will (§25 of the original doc already flagged this risk before any of this was built). Two honest options: (a) introduce a minimal cache table keyed by `(platform, source_product_id, window, input_hash)` storing the narrator's validated output, invalidated on `input_hash` change — restores the original §13 cost control; (b) accept live-call cost/latency for a first cut and revisit once real usage patterns exist. Recommend (a) if Phase 6's UI will realistically be used by more than one person hitting the same products repeatedly; (b) is defensible if usage will be low-volume initially. |

---

## 5. Runtime architecture notes

- **HTTP framework:** `express` (already a listed dependency, `^5.2.1`, currently unused) — no reason to introduce anything else; using it doesn't require a new decision.
- **Auth:** still genuinely undecided (§21/§26 Q6, Q13 were never resolved in any phase). Not proposing a specific mechanism here — this needs your explicit decision before Step 2 touches anything auth-related, same as the original document flagged it.
- **Job queue** (for the deferred `insights/regenerate` and any future async work): nothing exists in this codebase today (`runAiSentimentPipeline` is invoked as a one-shot script, not a queue worker). Out of scope until an endpoint actually needs it.

---

## Open decisions required before Step 2 (implementation)

1. Category C caching strategy — approve the in-process short-TTL memoization approach (§2), or propose an alternative.
2. `early_warning_signals` ack/resolve — build the minimal ack-state table, or descope the write endpoint for v1 (§4).
3. `ai_insights` caching — introduce the minimal cache table, or accept live-call cost/latency for v1 (§4).
4. Auth mechanism — still fully open (§5); Phase 6 cannot implement `PATCH`/`POST` write endpoints responsibly without at least a placeholder decision here.
5. Confirm the endpoint list in §3 (including the two deferred/dropped endpoints) before it becomes the literal implementation target in Step 2.

---

**Stopping here — design only. No routes, controllers, server wiring, migrations, database changes, frontend changes, or AI calls were made. Waiting for your explicit decisions on the open items above, and your approval, before Step 2.**
