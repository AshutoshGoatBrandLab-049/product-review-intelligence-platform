# Phase 7 — Step 7 — Brand Marketplace Comparison — Report

**Scope:** `/marketplace/brands/:brand` (Brand Marketplace Comparison) only, using only `GET /v1/brands/:brand/compare`. Product Marketplace Comparison, System, and every other page were not implemented or modified. Backend, database, and AI provider configuration were not modified.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Pre-coding inspection

Before writing any code, re-read: `src/api/controllers/brands.ts` (a direct pass-through to `compareBrandAcrossMarketplaces`, no Category C cache wrapper — this is "Category B" per its own comment, so the response carries no `cacheHit` field, unlike the four Category C pages built in Steps 2–6); `src/modules/analytics/marketplaceComparison.ts` in full, including the Phase 5 §15 three-bucket theme-consistency classifier and its explicit `insufficient_evidence` floor; `BrandParamsSchema`/`WindowQuerySchema` in `src/api/schemas.ts` (confirmed `brand` is a route param, `window` is the only query param — no `platform`/`theme`/other filter exists for this endpoint); `src/api/router.ts` (confirmed `GET /v1/brands/:brand/compare` requires `authenticate` + `anyRole`, no admin gate); `frontend/src/api/endpoints/brands.ts`, `useBrandComparison` in `frontend/src/hooks/queries/useMarketplace.ts`, `frontend/src/types/api.ts` (`BrandMarketplaceComparison`, `BrandAnalytics`, `ThemeConsistencyResult`); the Step 1 `BrandComparison.tsx` stub; the existing `MarketplaceBadge.tsx` component (already built in Step 1, fully matching `ThemeConsistencyClassification`'s three real values, unmodified and reused as-is); Product Detail (Step 3) for the `RatingDistribution`/`SentimentDistribution`/`InsufficientDataState` reuse pattern and its `Back to X` navigation convention.

**Cross-platform product-ID verification (explicitly re-checked per your instruction)**: read `compareBrandAcrossMarketplaces`'s source directly. It calls `computeBrandAnalytics(brand, window, "flipkart")` and `computeBrandAnalytics(brand, window, "myntra")` independently, and `getBrandThemeCounts` joins only on `product_dimension.brand = :brand AND platform = :platform` — no product ID appears anywhere in the brand-comparison code path. The code's own comment confirms this: *"no product-id mapping needed — brand_name exists on both sources today."* Product-ID mapping (`product_family_mapping`, genuinely empty) is exclusively `compareProductByFamily`'s concern, used only by `/v1/products/family/:familyId/compare` — untouched this step.

## 2. Objective

Build a two-platform brand comparison page — per-platform metrics, a platform-vs-platform rating gap, and theme-consistency classification — using only real backend fields, with no fabricated cross-platform product matching.

## 3. Files created

- `frontend/src/components/intelligence/BrandPlatformCard.tsx`
- `frontend/src/components/intelligence/ThemeConsistencyTable.tsx`
- `frontend/tests/pages/BrandComparison.test.tsx` (18 tests)
- `backend/scripts/phase7Step7BrandComparisonRealDataValidation.ts` — kept as a permanent, rerunnable deliverable

## 4. Files modified

- `frontend/src/pages/BrandComparison.tsx` — real implementation, replacing the Step 1 stub
- `frontend/src/hooks/queries/useMarketplace.ts` — added `placeholderData: keepPreviousData` to `useBrandComparison`, matching the same addition already made to every other window-driven hook in Steps 2–6 (`useFamilyComparison`, used only by the out-of-scope Product Comparison page, was left untouched)
- `frontend/tests/routes/routing.test.tsx` — updated the one existing assertion that checked the old stub's placeholder text (`"Brand Comparison — Bluepeak"`) to check the real page's immediately-rendered header content instead, following the exact precedent already set for the Product Detail route check in the same file (Step 3)

No backend, database, or AI configuration file was touched.

## 5. Exact API contract verified

`GET /v1/brands/:brand/compare?window=<NamedWindow>` (default `30d`). No `platform`/`theme`/other filter exists. Response: `{ brand, window, flipkart: BrandAnalytics, myntra: BrandAnalytics, ratingComparison: PeriodComparison, themeConsistency: ThemeConsistencyResult[] }`. `BrandAnalytics` = `{ brand, platform, productCount, recentMetrics: CoreMetrics, historicalMetrics: CoreMetrics, ratingComparison: PeriodComparison, trendDirection }`. The top-level `ratingComparison.current`/`.previous` are **not** a time-period comparison — they're `flipkart`'s and `myntra`'s average ratings respectively, reusing `comparePeriods`'s shape for a platform-vs-platform delta (documented in the source's own comment and preserved verbatim in this page's comments). `ThemeConsistencyResult` = `{ theme, flipkartFrequencyPercent: number | null, myntraFrequencyPercent: number | null, flipkartSampleSize, myntraSampleSize, classification: "marketplace_consistent" | "marketplace_specific" | "insufficient_evidence" }`.

## 6. UI behavior

Header shows the brand name (from the URL route param) and a "Back to Marketplace" link to `/marketplace/brands`. `WindowSelector` is the only filter, URL-synced via `?window=`. Body: a rating-gap card showing the backend's own `ratingComparison` fields exactly, side-by-side `BrandPlatformCard`s for Flipkart and Myntra (each: product count, review count, average rating, confidence badge, within-platform trend direction, rating distribution, sentiment distribution), and a `ThemeConsistencyTable` (theme, per-platform frequency, `MarketplaceBadge` classification) in the backend's own order (alphabetical by theme, never re-sorted client-side).

**Rating-gap display rule (a deliberate design decision, not a backend behavior)**: `compareBrandAcrossMarketplaces` computes its top-level `ratingComparison` using `averageRating ?? 0` internally when a platform has zero reviews for the brand — a real, documented backend substitution. Displaying that 0-substituted gap as a headline number would read as "this marketplace is rated 0 stars," misleadingly implying poor performance rather than missing data. The page therefore only renders the rating-gap card when **both** platforms have a genuine non-null average; otherwise it shows `InsufficientDataState` instead. This is presentational judgment about what to display, not a recomputation of any value — every number that is shown is still the exact backend-provided figure.

## 7. State handling

Loading (skeleton), error (`ErrorState` — 401 → "Session expired", 403 → "Not permitted", 500/network → generic with Retry), null `averageRating`/`flipkartFrequencyPercent`/`myntraFrequencyPercent` render as `—` (never a fabricated 0), zero-review platforms render their own `InsufficientDataState` inside their card, `insufficient_data`/`insufficient_evidence` states rendered honestly via the existing `ConfidenceBadge`/`MarketplaceBadge` — never hidden. A brand with zero products on either or both platforms is a real, valid 200 response (confirmed by source: the endpoint never 404s), rendered as real zeros, not as an error or a "no mapping" state — there is no such state at the brand level (that concept exists only for the out-of-scope product-family endpoint). All **UNIT-TEST PROVEN**.

## 8. Tests

**18/18 new tests passing**, covering: render, exact brand identity from the URL, exact backend-returned per-platform values, exact backend-computed rating-gap values, exact theme-consistency classification, null-value handling (`—`, never fabricated 0), a zero-product-on-one-platform brand rendered honestly with no fabricated mapping language, the rating-gap card correctly hidden (in favor of `InsufficientDataState`) when either side lacks a real average, loading state, 401, 403, generic 500, retry re-issuing the request, window URL sync, absence of any fabricated cross-marketplace product link/identifier, no client-side analytics (exactly one API call, numbers match the backend exactly), exact request-parameter check (`getBrandComparison` called with exactly `(brand, window, signal)`), and a working "Back to Marketplace" navigation link.

**Full frontend suite: 165/165** (147 pre-Step-7 baseline + 18 new). No existing test was weakened — one existing test (`routing.test.tsx`'s Brand Comparison route check) was **updated**, not weakened, to assert the real page's real content instead of the now-removed stub's placeholder text, following the identical precedent already established for the Product Detail route check in Step 3.

Two real defects caught during test-writing (not shipped): (1) the page's `<h1>{brand}</h1>` renders the brand name from the URL unconditionally, independent of query state — an early draft's `findByRole("heading", ...)` used as a load-wait resolved before the query settled, the same class of bug flagged in Steps 5 and 6 (a different concrete cause each time — split node, static filter tab, and now an unconditionally-rendered URL-derived header); fixed by waiting on a `findAllByText` anchor that only exists once the platform cards have rendered. (2) "Flipkart"/"Myntra" text is genuinely ambiguous (it appears as both a card title and a table column header) — fixed with a small `findPlatformCard` test helper that resolves to the card specifically, not the table header.

## 9. Build/typecheck

Frontend `tsc -b`: clean. `npm run build`: succeeded (854.55 KB minified JS — the same pre-existing chunk-size advisory noted since Step 3, unrelated to this step, not addressed here).

## 10. Backend regression

**308/308 passing**. Backend `tsc --noEmit`: clean. `npm run safety-check`: OK. No backend file touched.

## 11. Real-data validation (PROVEN BY EXECUTION)

`backend/scripts/phase7Step7BrandComparisonRealDataValidation.ts`, `AI_PROVIDER=mock` forced (this endpoint has no AI path at all — verified by source, guard kept for consistency), against the real dataset. A real, verified-to-exist-on-both-platforms brand was found first by direct query (not assumed) — "Bluepeak": 32 Flipkart products, 31 Myntra products.

| Query | Result |
|---|---|
| `brand=Bluepeak, window=30d` | Flipkart: 32 products, 720 reviews, avg 3.77, confidence `high`. Myntra: 31 products, 522 reviews, avg 3.62, confidence `high`. `ratingComparison`: current 3.77, previous 3.62, absoluteDelta ≈0.15, percentageDelta ≈4.14. First 3 theme-consistency rows shown, all real (`color`/`comfort`/`delivery`, each `marketplace_specific` in this real slice — Myntra had 0% frequency for all three in this brand/window) |
| `brand=<fabricated nonexistent name>` | `status=200`, `flipkart.productCount=0`, `myntra.productCount=0`, script asserts `averageRating === null` on both sides (would throw `DEFECT` otherwise) — the real, honest zero-data path, not simulated |

The script additionally asserts, against the real response: every `themeConsistency[].classification` is one of the three documented values (would throw `DEFECT` otherwise), and no `severity`/`severityScore`-shaped field is present anywhere in the response. Neither threw.

## 12. Database before/after

Before: `normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`, `ai_insights=3`. After: identical, independently re-verified via direct SQL — this endpoint is confirmed read-only. The 3 `ai_insights` rows were independently re-checked by platform/sourceProductId/`created_at` and are byte-identical to the state reported at the end of Step 6 (`myntra/100406`, `flipkart/FKPID000006`, `flipkart/FKPID000252`) — none deleted, modified, or recreated, per your explicit instruction to leave them untouched.

## 13. AI call count

**Zero.** This page and its backend endpoint have no AI code path at all; `AI_PROVIDER=mock` was additionally forced during validation as defense in depth.

## 14. Production-access confirmation

No production database access.

## 15. Issues found and fixed

The two test-authoring defects described in §8 (unconditional-header false load-wait; ambiguous "Flipkart"/"Myntra" text match) — both test-only, not component defects. No product-code defects were found; the real-data validation script's structural assertions (valid classifications, no severity field, honest zero-data path) all passed on the first run.

## 16. Known limitations

- No brand search/selection UI — `BrandsIndex.tsx` (`/marketplace/brands`) remains the Step 1 stub, exactly as it was before this step. This is out of scope per your explicit instruction (Step 7 is Brand Marketplace Comparison only); a brand is reached today only via a direct URL, the same way Product Detail is reached only via drill-down before a search UI exists for it.
- The displayed rating-gap card is suppressed (in favor of `InsufficientDataState`) whenever either platform has zero reviews for the brand, per §6's reasoning — this means the page never shows the backend's raw 0-substituted `ratingComparison` values in that case, a deliberate display choice.
- The pre-existing chunk-size build warning (noted since Step 3) remains unaddressed.

## 17. Evidence classification summary

- **PROVEN BY EXECUTION**: typecheck/test/build results, backend regression, the real-data validation script's exact output, database before/after equality, the `ai_insights` row-identity check.
- **UNIT-TEST PROVEN**: every filter/state-handling/no-fabrication/no-cross-platform-ID claim in §6–§8.
- **OBSERVED**: the real "Bluepeak" brand's real per-platform/theme-consistency numbers (§11) are today's snapshot.
- **NOT MEASURED**: real end-user perceived load latency in an actual rendered browser session.

---

**Phase 7 Step 7 is complete. Step 8 has NOT started.**
