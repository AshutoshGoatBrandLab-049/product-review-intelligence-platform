# Phase 7 — Step 3 — Product Detail — Report

**Scope:** `/products/:platform/:sourceProductId` only. No other page implemented. Backend, database, and AI provider configuration were not modified.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Objective

Build the Product Detail intelligence page — analytics, health, sentiment, early-warning signals, evidence, and an explicitly user-triggered AI insight — using only the existing Phase 6 API, with zero client-side analytics and zero automatic AI calls.

## 2. Pre-implementation finding (resolved with your explicit decision)

Source inspection (`productAnalytics.ts`, `coreMetrics.ts`, `earlyWarning.ts`, `narrator.ts`) found **no deterministic per-product theme endpoint** in the Phase 6 API — `ProductAnalytics`/`CoreMetrics` carry no theme field, `EarlyWarningSignal` carries `signalType` not a theme, and the one place a `theme` field exists (`ProductEvidencePackage.topThemes`/`topNegativeThemes`) is internal to the AI prompt builder and never returned by any endpoint. Per your decision, themes are folded into the AI Insight section only (`rootCause[].theme`, clearly AI-labeled) — no separate deterministic "Themes" section was built, and no new endpoint was added.

## 3. Files created

- `src/lib/signals.ts` — `splitSignalsByReadiness`, extracted from Dashboard.tsx (Step 2) for reuse, not duplicated
- `src/pages/ProductDetail.tsx` — real implementation, replacing the Step 1 stub
- `tests/pages/ProductDetail.test.tsx` (28 tests)
- `backend/scripts/phase7Step3ProductDetailRealDataValidation.ts` — kept as a permanent, rerunnable deliverable

## 4. Files modified

- `src/pages/Dashboard.tsx` — refactored to use the extracted `splitSignalsByReadiness` (pure refactor; Step 2's 18 tests still pass unchanged, confirming behavior is identical)
- `src/hooks/queries/useProduct.ts` — added `placeholderData: keepPreviousData` to `useProductDetail`/`useProductSignals` only (`useProductInsights` untouched — still `enabled`-gated, still `retry:false`)
- `tests/routes/routing.test.tsx` — one pre-existing assertion updated (see §14)

No backend, database, or AI configuration file was touched.

## 5. API endpoints consumed

`GET /v1/products/:platform/:sourceProductId`, `.../signals`, `.../insights` — exactly three, all pre-existing. No `/v1/products/family/:familyId/compare` call (marketplace comparison explicitly out of scope this step).

## 6. UI sections

Header (identity, platform badge, real brand, window selector, back link) → Executive summary (4 KPI cards: rating, review count, rating score, trend) → Health score components (5 fields, severity/total always "Not available yet") → Rating distribution + Sentiment (side by side) → Early-warning signals (active + "Not Available Yet" grouped panel) → Evidence (deduplicated `evidenceReviewIds` from active signals) → AI Insight (explicit "Generate AI Insight" gate, `AIInsightCard` on success).

## 7. State handling

`insufficient_data`/`not_ready`/`no_mapping`-class states all reuse Step 1's generic components; 401/403/404/429/500/`ai_unavailable` all reuse `ErrorState`'s existing kind-mapping (`not_found` falls through to the generic "Something went wrong" branch, which does not crash — verified, test #12). No fabricated severity, confidence, or time-series chart anywhere (**UNIT-TEST PROVEN**, tests #25/#26).

## 8. AI safety behavior

- `useProductInsights`'s `enabled` is derived synchronously from `requestedForKey === currentKey` (platform+product+window), not a `useState`+`useEffect` reset — a real race was found and fixed here (§13).
- No request fires on mount (**UNIT-TEST PROVEN**, test #16).
- Exactly one request per click (**UNIT-TEST PROVEN**, test #17), no repeat on unrelated re-renders (test #22), no automatic call on window change (test #24).
- `retry:false` preserved from Step 1 — failures never auto-retry; the only retry path is `ErrorState`'s explicit button, itself calling `refetch()` only on click (test #21).

## 9. Test count

**28/28 new tests passing** (`ProductDetail.test.tsx`), covering all 28 required scenarios. **Full frontend suite: 95/95** (67 pre-Step-3 baseline + 28 new). One pre-existing test updated, not weakened (§14).

## 10. Build/typecheck results

Frontend `tsc -b`: clean. `npm run build`: succeeded (833 KB minified JS, above Vite's 500 KB advisory threshold — a real, disclosed finding, not acted on this step; see §17).

## 11. Backend regression

**308/308 passing**, confirmed twice (once concurrently with the frontend build, where `apiRateLimit.test.ts` timed out transiently under resource contention; re-run in isolation immediately after — clean, 308/308). Backend `tsc --noEmit`: clean. `npm run safety-check`: OK. No backend file was touched this step.

## 12. Real-data validation (PROVEN BY EXECUTION)

`backend/scripts/phase7Step3ProductDetailRealDataValidation.ts`, run against the real dataset with `AI_PROVIDER=mock` forced (hard runtime guard, matching the Phase 6 Step 3 / Phase 7 Step 2 pattern), using a real product picked by highest review count (not fabricated): **flipkart/FKPID000256** (brand: Northline).

| Window | totalReviews | averageRating | confidence | ratingScore | severityScore/totalScore | signals |
|---|---|---|---|---|---|---|
| 30d | 51 | 3.69 | medium | 67.25 | null/null (script asserts, would throw otherwise) | `product_deterioration: not_ready` only |
| 90d | 138 | 3.69 | high | 67.25 | null/null | `product_deterioration: not_ready` only |

AI insight (mock provider): real `summary`/`rootCause`/`recommendations` returned, one `ai_insights` row created, then deleted by the script before exit.

## 13. Database before/after

Before: `normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`, `ai_insights=1`. After: identical — `ai_insights=1` (the script's own row was created and cleaned up; **the count of 1 both before and after is not "empty," it is a pre-existing real row from live usage — see §16**). Independently re-verified via direct SQL, not just the script's own check.

## 14. AI call count / issues found and fixed

**Real, important finding, not caused by this step's code:** while checking the database before running my validation script, I found a real `ai_insights` row (`myntra/100406`, created `2026-08-13 23:40:56`) whose narrative text does not match `MockAiProvider`'s rigid template — consistent with a genuine Gemini call. The backend dev server had been running since earlier in this session (started per your request to configure local dev auth) against the real `backend/.env`, which has `AI_PROVIDER=gemini`. Once the frontend picked up the newly-built `ProductDetail` page via HMR, a real click on "Generate AI Insight" in the browser would go through that live server and make a real, billable call — through direct user interaction, not anything this session scripted or automated.

**Action taken, per your explicit decision:** left the row untouched (confirmed still present, unchanged, after this step's validation run) and stopped the live dev server (per your explicit decision) rather than silently deleting real data. This step's own automated work — every test, and the validation script — made **zero** real AI calls, independently guarded (`AI_PROVIDER=mock` hard-checked at script start).

Two other real defects found and fixed during this step's own construction:
1. **AI window-change race**: the original `useEffect`-based reset of `insightRequested` left one render where the old "requested" state coexisted with the new window, briefly enabling a real fetch for a window the user never asked for. Fixed by deriving `insightRequested` synchronously from a requested-key comparison instead of an effect (§8).
2. **Test-timing races** (4 of the 28 new tests): several tests waited on `screen.findByText("PID001")` as a stand-in for "data has loaded," but the product ID renders immediately from the URL param, independent of the API response — the same class of bug found and fixed in Step 2. Fixed by waiting on genuinely data-dependent content instead.

## 15. Production-access confirmation

No production database access. `gbl_data_lake`'s `product_review_intelligence` schema (the local app store, not the read-only production source) is unchanged except for the pre-existing real row discussed in §14, which predates this step's work and was left in place per your decision.

## 16. Known limitations

- No deterministic "Themes" section exists — folded into AI Insight only, per your decision (§2).
- No marketplace-comparison UI on this page (out of scope this step).
- The `ai_insights` table now contains one real row from genuine (non-mock) usage during this session — worth being aware of if a future step assumes the table starts empty on the real dataset.
- Frontend production bundle is 833 KB minified — no code-splitting yet (flagged in the original Phase 7 architecture design doc §17 as a later-step concern, not addressed this step).
- Evidence section aggregates IDs across all active signals into one list rather than grouping per-signal — a reasonable simplification, not a fabrication (every ID shown is real and API-sourced).

## 17. Evidence classification summary

- **PROVEN BY EXECUTION**: all typecheck/test/build results, backend regression (both runs), the real-data validation script's exact output, database before/after equality.
- **UNIT-TEST PROVEN**: every AI-safety claim in §8, no-fabricated-severity/chart claims, window-sync behavior, drill-down/back-navigation links.
- **OBSERVED**: the real product's real values (§12) are today's snapshot, not a claim about future runs; the pre-existing real `ai_insights` row's likely Gemini provenance is inferred from its text style, not independently confirmed against Gemini API logs.
- **NOT MEASURED**: real end-user perceived load latency in an actual rendered browser session (validated via `supertest` at the API level, consistent with Step 2).

---

**Phase 7 Step 4 has NOT started.** Not implementing any other page, not touching the backend/database further, not deploying — waiting for explicit approval before Step 4.
