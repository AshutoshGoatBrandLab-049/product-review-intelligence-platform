# Phase 5 — Early Warning & Marketplace Comparison — Implementation Report

**Scope:** deterministic early-warning rule engine + brand-level (day-one) and product-level (gated, unpopulated) Flipkart-vs-Myntra marketplace comparison, built on Phase 3's existing compute-on-demand analytics layer. No API, no frontend/dashboard, no deployment, no production database access, no real Gemini/Anthropic calls anywhere in this phase — confirmed at the end (§11).

Status vocabulary used throughout, per this phase's governing instruction:

- **PROVEN BY EXECUTION** — a real script or test ran against a real database and produced this exact output.
- **UNIT-TEST PROVEN** — covered by a permanent, passing automated test (`npm test`).
- **OBSERVED** — a real measurement was taken, but the result depends on a choice (window size, dataset composition, sample) that could reasonably differ elsewhere; not a universal claim.
- **NOT MEASURED** — deliberately out of this phase's scope; no claim is made either way.
- **INFERRED** — a conclusion reasoned from other proven/observed facts, not directly executed.

---

## 1. What was built vs. reused

Phase 5 extended, rather than replaced, Phase 3's existing compute-on-demand analytics architecture (no persisted rollup tables were reintroduced; `docs/architecture/phase-3-analytics-design.md`'s divergence from the original Phase 2 precomputed-table design was carried forward as-is — documented, not silently continued).

| Component | Status before Phase 5 | Status after Phase 5 |
|---|---|---|
| `earlyWarning.ts` — `detectProductSignals` | 4/6 signal types live, 2 stubbed `not_ready`, thresholds hardcoded | 5/6 signal types live (`complaint_spike` completed), thresholds externalized to env config, `product_deterioration` still `not_ready` (deliberate descope, §4) |
| `detectAllProductSignals` (catalog sweep) | Did not exist | New — keyset-paginated, same cursor pattern as ingestion/AI candidate selection |
| `brandAnalytics.ts` — `computeBrandAnalytics` | Existed, single-platform or combined only | Unchanged, reused as-is by the new comparison layer |
| `marketplaceComparison.ts` | Did not exist | New — `compareBrandAcrossMarketplaces`, `classifyThemeConsistency`, `getProductFamily`, `compareProductByFamily` |
| `product_family_mapping` table | Did not exist | New, migration `012` — created and remains genuinely **empty** (§6) |

---

## 2. Configurable thresholds (Step 1)

Externalized to Zod-validated `config.earlyWarning`, replacing in-file constants — same pattern as every other tunable in this codebase (`CONFIDENCE_THRESHOLDS`, `TREND_THRESHOLDS`).

| Threshold | Pre-Phase-5 value | Final value | Basis |
|---|---|---|---|
| `WARNING_RATING_DECLINE_PCT` | `-15` (hardcoded) | `-15` (unchanged) | Step 4 real-data check: already selective (6.2% catalog firing rate) — left as-is, evidence-backed "no change needed" |
| `WARNING_NEGATIVE_INCREASE_PCT` | `20` (hardcoded) | `100` | Step 4: `20` sat near the ~64th percentile of real observed growth rates — too noisy; raised based on the observed distribution |
| `WARNING_VOLUME_SPIKE_MULTIPLIER` | `2` (hardcoded) | `3` | Step 4: `2` sat almost exactly at the real median (1.92x) — was capturing ordinary background growth, not anomalies; raised based on the observed distribution |
| `WARNING_COMPLAINT_SPIKE_PCT` | did not exist | `200` | Step 4: no prior value existed to inherit; this is the signal's first-ever default, derived from the real observed complaint-mention growth-rate distribution, not guessed |

**These four values are tuned to this specific ~100K-row local dataset (1,004 products, 21 brands, a roughly 12-month date span). They are not validated as universally optimal production thresholds** — Step 4's method (percentile-based, evidence-documented) is sound and repeatable, but re-running it against a different or larger dataset could reasonably produce different numbers. Treat them as a documented starting point, not a final answer.

---

## 3. Early-warning signal types

| Signal | Status | Notes |
|---|---|---|
| `sudden_rating_decline` | Live | Unchanged from Phase 3 |
| `sudden_negative_review_increase` | Live | Unchanged from Phase 3 |
| `review_volume_spike` | Live | Unchanged from Phase 3 |
| `persistent_negative_trend` | Live | Unchanged from Phase 3 |
| `complaint_spike` | **Live (Step 2)** | New. Proxy definition: a `review_theme` mention on a review with `rating <= 2 OR review_sentiment.label = 'negative'`, within-window vs. previous-equivalent-window growth rate. Chosen because the actual `review_theme` table has no `is_complaint`/`severity` column (the original architecture assumed one; Phase 3/4 never built it that way) — this is a non-invasive interpretation, not a schema change. |
| `product_deterioration` | **Still `not_ready`, unconditionally** | Deliberately descoped (your explicit decision, pre-implementation): completing it would require inventing an unvalidated severity formula, which conflicts with this project's practice of never stating an unproven hypothesis as fact. Every product, every call, returns `confidence: "not_ready"`, `evidenceReviewIds: []` — **UNIT-TEST PROVEN** never to fire, in both the isolated-fixture suite and the real-dataset sweep (§9). |

All 5 live signals, plus `product_deterioration`'s permanent `not_ready` state, are **UNIT-TEST PROVEN** (`tests/integration/earlyWarningSignals.test.ts`, 10 tests, §8) and **PROVEN BY EXECUTION** against the real dataset (§9).

---

## 4. Window sensitivity — an important, non-obvious real finding (OBSERVED)

Early-warning results are **strongly dependent on the selected analysis window relative to how much historical data actually exists**, not just on threshold values. This was discovered, not assumed, in Step 8:

The real dataset's `review_date` values span almost exactly one year (`2025-08-12` to `2026-08-12`, `asOf` = `2026-08-13`).

| Window | `previousEquivalentWindow` falls | Real sweep result (1,004 products) |
|---|---|---|
| **12 months** | Almost entirely *before* the dataset's actual date range — historical-period data is nearly empty for most products | Only `product_deterioration` (1,004, `not_ready`) and `review_volume_spike` (209, all `confidence: "insufficient_data"`) appeared. `sudden_rating_decline`, `sudden_negative_review_increase`, `persistent_negative_trend`, `complaint_spike`: **zero** fired — correctly suppressed by the `bothConfident` gate, since the historical comparison period had no real data to compare against. |
| **90 days** | Fully inside the dataset's real date range — both recent and previous-90d periods have genuine data | All 5 live signal types fired with real confidence distributions: `persistent_negative_trend` (154), `sudden_negative_review_increase` (104), `sudden_rating_decline` (62), `review_volume_spike` (64), `complaint_spike` (28, several at `medium`/`high` confidence). |

**This is the rule engine behaving correctly, not a defect** — the confidence gate is doing exactly what it's supposed to do when a comparison period genuinely lacks data. But it means **any consumer of this system must choose an analysis window that actually fits inside the available historical data**, or the signals will silently and correctly go quiet rather than fire. This dependency was not previously documented and is a required reading note for whoever operates Phase 5's output.

---

## 5. Brand-level marketplace comparison (Step 5) — day-one capability

`compareBrandAcrossMarketplaces(brand, window)` — calls the existing `computeBrandAnalytics` for each platform, adds a rating-gap comparison and a per-theme three-bucket classification (`classifyThemeConsistency`):

- `marketplace_consistent` — theme frequency on both platforms within a 2.0x ratio band (`THEME_CONSISTENCY_RATIO_BAND` — **an explicitly unvalidated starting hypothesis**, same "hypothesis, not approved" treatment this project already gives health-score weights; not empirically tuned the way the Step 4 thresholds were).
- `marketplace_specific` — frequencies fall outside the ratio band, or the theme is genuinely absent on one side.
- `insufficient_evidence` — either platform's total review count for the brand is below the confidence floor (5 reviews) — returned explicitly, never guessed past the floor.

All three buckets are **UNIT-TEST PROVEN** (`tests/integration/marketplaceComparison.test.ts`, §8) both as a pure function and via real ingested fixture data.

### Real-dataset result — important caveat required (OBSERVED, root-caused)

Running the real comparison for the 5 highest-volume qualifying brands (Bluepeak, Palecove, Solstice Studio, Grovewell, Verona Basics — all `confidence: "high"`, 2,400–4,400+ reviews per side) produced **`marketplace_specific` for every theme, on every brand**, with Myntra-side theme frequency at or near 0% almost everywhere.

**Do not read this as evidence of genuine marketplace behavioral differences.** Root cause, confirmed by direct query, not assumed:

| | Flipkart | Myntra |
|---|---|---|
| `review_theme` mentions (real dataset) | 8,897 | **36** |
| `review_sentiment` rows (real dataset) | 5,024 | **11** |

This is a real, pre-existing **Phase 4/4.1 AI-classification coverage gap**: theme and sentiment extraction were run almost exclusively against Flipkart data in this local dataset. `classifyThemeConsistency` is behaving correctly on the input it was given — with real Myntra theme data this sparse, `marketplace_specific` is the honest classification, not a bug in Phase 5's logic. It reflects an **upstream data-coverage limitation, out of Phase 5's scope to fix**, not a finding about actual Flipkart-vs-Myntra customer behavior.

The one rating-only comparison unaffected by this gap (both platforms have full rating/review-count data) showed small, real gaps for the top 5 brands — absolute rating deltas of roughly 0.01–0.07 stars (≈0.3%–1.9% relative), all `confidence: "high"`.

---

## 6. Brand qualification for real comparison (PROVEN BY EXECUTION, Step 8)

Queried the real dataset (12-month window) for brands present on both platforms:

- **21 distinct brands total, all 21 present on both platforms** — no brand in this dataset exists on only one side.
- **20 of 21 qualify** for a confidence-backed comparison (≥5 reviews on both sides — `CONFIDENCE_THRESHOLDS.minReviewsForLowConfidence`).
- **1 does not qualify: `CtrlBrand`** (Flipkart = 4 reviews, Myntra = 2 reviews). Running the real comparison against it anyway (to observe the gate, not to force a result) correctly returned `confidence: "insufficient_data"` on both sides and **zero** theme-consistency entries — no theme met the sample-size floor. This is the confidence gate working correctly on genuinely thin real data.

No brand's comparison was manufactured or assumed; every number above came from a real query against `gbl_data_lake`.

---

## 7. Product-family-mapping (Step 6) — gated, deliberately empty

`product_family_mapping` (migration `012`) is the sole persisted table this phase adds — justified because there is no join key between Flipkart `pid` and Myntra `product_id` (§15 of the original architecture); it is reference data that cannot be computed, unlike everything else in Phase 3/4/5.

- Table is **genuinely empty** in the real dataset — confirmed via direct query before and after every step through Step 8 (§10). No fuzzy-matching, no auto-population, no business-provided data exists yet, per your standing instruction.
- `getProductFamily(platform, sourceProductId)` and `compareProductByFamily(familyId, window)` are implemented, **UNIT-TEST PROVEN** (both the no-mapping path and a real mapping-present path, via test-inserted-and-deleted rows in the isolated fixture only — never the real dataset).
- **No cross-marketplace product-level comparison was performed against real data anywhere in this phase**, and none should be claimed — the table being empty means `compareProductByFamily` would correctly return `{available: false, reason: "no_mapping"}` for every real product today. This is the expected, correct state until someone deliberately, manually populates a mapping — not a gap in Phase 5's delivered scope.

---

## 8. Tests (Step 7)

Two new dedicated files, **19 new tests**, isolated fixture DB only, zero real Gemini/Anthropic calls:

| File | Tests | Covers |
|---|---|---|
| `tests/integration/earlyWarningSignals.test.ts` | 10 | All 5 live signal types firing with correct evidence/thresholds, `product_deterioration` confirmed permanently `not_ready`, explicit threshold-override behavior (both directions, two signal types), the pre-Step-4 no-threshold-supplied fallback path, and `detectAllProductSignals`'s keyset-paginated catalog sweep |
| `tests/integration/marketplaceComparison.test.ts` | 9 | `classifyThemeConsistency`'s all 3 buckets (direct + integration), `compareBrandAcrossMarketplaces` against real ingested brand data, `product_family_mapping` gating (no-mapping, full two-sided mapping, and a one-sided mapping → `insufficient_data`, never fabricated) |

Two real defects were found and fixed by executing these tests, not assumed:

1. A pre-existing test (`tests/integration/migrations.test.ts`) hardcoded "eleven migrations" — broke predictably once migration `012` was added; updated to twelve and to include `product_family_mapping` in the expected-table list.
2. The catalog-sweep test initially asserted an exact product count, which broke against a shared baseline seed (`PID001`/`PID002`) present in the isolated fixture DB for other test files; corrected to a `>=` assertion, which is the structurally correct way to test against a shared fixture.

Full regression history through the phase: 227 (pre-Phase-5 baseline) → 229 (Step 4, `complaint_spike` test split — a necessary, expected consequence of giving it a real default, not a silent break) → 248 (Step 7, +19 new) → **248/248 (Step 8, unchanged)**.

---

## 9. Real-dataset catalog sweep (Step 8, PROVEN BY EXECUTION)

`detectAllProductSignals` run against all 1,004 real products, `config.earlyWarning` defaults, at both window sizes (§4 has the full breakdown). Summary:

- 12-month window: 2 signal types fired (both effectively inert — 1 permanently `not_ready`, 1 entirely `insufficient_data`).
- 90-day window: all 5 live signal types fired with real, non-trivial confidence distributions.

No production data was touched by this sweep — it is a pure read over the already-ingested local app-store tables.

---

## 10. Database safety — before/after every step

Direct SQL re-verification, real dataset (`gbl_data_lake`), captured at Step 0 and re-confirmed identically through Step 8:

| Check | Value | Stable through all 9 steps? |
|---|---|---|
| `normalized_reviews` count | 100,006 | Yes |
| `normalized_reviews` checksum (`md5` of ordered `canonical_review_id \|\| content_hash`) | `821903ac625da7ee6256e2b6344ce868` | Yes — byte-identical every time it was checked |
| `review_sentiment` count | 5,035 | Yes |
| `review_theme` count | 8,933 | Yes |
| `product_dimension` count | 1,004 | Yes |
| `product_family_mapping` count | 0 | Yes — remained empty at every checkpoint, including the final Step 8 check |
| `DataWarehouse.flipkart_reviews` count | 50,007 | Yes |
| `DataWarehouse.myntra_reviews` count | 50,002 | Yes |

The only schema change across the entire phase is the addition of the empty `product_family_mapping` table (migration `012`, applied to both the real dataset and the isolated fixture, confirmed idempotent). Every other table's row count and content checksum are unchanged from the pre-Phase-5 baseline.

---

## 11. Confirmations

```
PRODUCTION DATABASE ACCESSED:        NO
PRODUCTION TABLES MODIFIED:          NONE
PRODUCTION TABLES CREATED:           NONE
PRODUCTION DATA MODIFIED:            NONE
REAL/PRODUCTION AI PROVIDER CALLED:  NO — Gemini/Anthropic were never invoked anywhere in Phase 5.
                                      earlyWarning.ts and marketplaceComparison.ts import no AI
                                      provider; every signal/comparison in this phase is pure,
                                      deterministic arithmetic over already-ingested data.
DataWarehouse.flipkart_reviews / myntra_reviews: READ ONLY throughout Phase 5 in the real
                                      dataset. All test-control rows used for Phase 5's isolated
                                      fixture tests were inserted into and removed from
                                      `pri_test_prodsource` only — verified clean via direct
                                      query after every test run.
API / FRONTEND / DASHBOARD / DEPLOYMENT: NONE BUILT — none were in scope this phase.
```

Final regression state: `npx tsc --noEmit` clean · `npm test` **248/248 passing** · `npm run safety-check` OK.

---

## 12. Known limitations (consolidated)

- **`product_deterioration` has no severity formula** — permanently `not_ready`, by deliberate descope, not an oversight.
- **The 4 tuned thresholds (§2) are dataset-specific**, not validated as universally correct production defaults. Re-tuning against a different dataset (different scale, brand mix, or date range) could reasonably produce different values.
- **`THEME_CONSISTENCY_RATIO_BAND = 2.0` is an unvalidated starting hypothesis**, unlike the Step 4 thresholds — it was never empirically tuned against the real distribution the way the early-warning thresholds were.
- **Signal-firing behavior is highly window-dependent** (§4) — a window whose historical comparison period falls outside the actual data range will correctly, but perhaps surprisingly, produce almost no live signals.
- **Real theme-consistency results are currently dominated by a Myntra AI-classification coverage gap** (§5), not genuine marketplace differences — this is a Phase 4/4.1 upstream data limitation, not something Phase 5 can or should fix.
- **`product_family_mapping` is empty by design** — no product-level cross-marketplace comparison exists for any real product today, and none should be claimed until the table is deliberately, manually populated (a separate, future business decision, explicitly out of this phase's scope).
- **No human-reviewed trial period was run** — Step 8 produced the observed signal/noise data (§9), but judging whether that firing rate is operationally acceptable is a decision reserved for you, not something this report concludes on your behalf.

---

## GO / NO-GO

**GO for Phase 5's actual delivered scope**: deterministic early-warning rule engine (5/6 signal types live, 1 honestly `not_ready`), configurable and evidence-tuned thresholds, a catalog-wide sweep, brand-level marketplace comparison with an honest 3-bucket theme classifier, and a gated (currently inert, correctly empty) product-family-mapping path. All of it is unit-test proven, re-verified against the real ~100K-row dataset, and has produced zero regressions and zero database drift across 9 steps.

**Not a GO for any production-readiness claim** — the thresholds are dataset-tuned, the theme-consistency results are currently confounded by an upstream AI-coverage gap, and no human has yet reviewed the real signal output for acceptable signal-to-noise (§12). Those are open items for you to weigh, not something this phase resolves unilaterally.

---

**Stopping here. Not starting Phase 6, API, frontend, dashboard, or production integration — waiting for your explicit approval.**
