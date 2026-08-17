# Phase 8 — Step 3 — Product Rankings Transformation — Report

**Scope:** `/products` (Product Rankings) only. No other page was touched. Backend, database, AI provider, and deployment were not touched (one pre-existing backend defect was **discovered** during real-data validation but explicitly **not fixed** — see §24).

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Objective

Turn Product Rankings from a technically-correct catalog table into a fast prioritization workspace — stronger row hierarchy, real navigation, a genuine mobile/tablet layout, and honest labeling of exactly what each sort mode means — using only the fields the backend already returns.

## 2. Pre-coding inspection

Re-read fresh from source (not from prior reports) before writing any code: `backend/src/api/controllers/rankings.ts`, `RankingsQuerySchema` in `backend/src/api/schemas.ts`, `frontend/src/api/endpoints/rankings.ts`, `useProductRankings` in `useCategoryC.ts`, the pre-edit `Products.tsx`/`RankingsTable.tsx`, `MetricCard`/`StatusBadge`/`ConfidenceBadge`, `MoverCard.tsx` (Dashboard's mover pattern, for row-design precedent), the Product Detail route in `router.tsx`, the Phase 7 Step 4 report, and the Phase 8 Step 0/1/2 reports. **No discrepancy was found** between the actual current contract and the prior reports — confirmed identical.

## 3. Verified API contract

`GET /v1/products/rankings` — query params: `window` (default `30d`), `sort: "health"|"rating"` (default `health`), `platform?`, `brand?` (exact match, ≤200 chars, no fuzzy/partial matching anywhere in the call chain), `page` (≥1, default 1), `pageSize` (≥1, max 100, default 20). No other parameter exists or is validated.

**Sort semantics, verified against the actual comparator, not assumed:**
- `sort=health` ranks by `HealthScore.ratingScore` — **not** a composite "health" score. `severityScore`/`totalScore` are always `null` (no approved formula). `trendScore` is a real, separate 0–100 field, documented in `healthScore.ts` as centered at 50 (50 = no change from the prior period).
- `sort=rating` ranks by `ProductAnalytics.recentMetrics.averageRating`.
- The backend's own comparator (`ranked.sort((a, b) => (b.sortValue ?? -1) - (a.sortValue ?? -1))`) always sorts **descending**, with **no secondary tiebreaker** — this fact directly produced the real defect in §24.
- Confidence exists only on the `rating` branch (`ProductAnalytics.recentMetrics.confidence`); `HealthScore` has no confidence field.
- `trendDirection` (`"improving"|"declining"|"stable"|"insufficient_data"`) is a real field on `ProductAnalytics` that the pre-Step-3 `RankingsTable` never displayed — confirmed present in the type and populated by the real controller; now shown for `sort=rating`.

## 4. Information architecture

Header (title + description + `WindowSelector`, unchanged) → control bar (Sort / Platform / Brand, unchanged mechanics) → a new one-line sort-meaning caption (§5) → a new results-summary row with real, removable filter chips → the ranking view itself (table on desktop/tablet, cards on mobile — §8) → pagination (unchanged mechanics, existing labels).

## 5. Ranking semantics

Only the two backend-supported sort modes are exposed — unchanged, no third option was added. A new static caption under the control bar states exactly what each mode means (quoting the real field, e.g. *"Orders by real-time rating score (0-100 scale) — not a composite score. Severity/total remain unavailable."*) so "Health" is never misread as an overall composite ranking. The Trend-score column header (health sort) gained a `Tooltip` explaining its real 0–100/centered-at-50 scale — **static explanatory text, not a computed value**; no "improving/declining" label is derived from it, since that would itself be a forbidden client-side trend calculation. For `sort=rating`, the real `trendDirection` enum (already computed server-side) is now displayed via a `StatusBadge`, a straight 1:1 label/tone mapping of an already-real value — not an inference.

## 6. Filter UX

Platform/brand/window/sort filters are functionally unchanged (same params, same URL sync, same page-reset-on-filter-change behavior, same uncommitted-brand-draft pattern). New: a results-summary row shows the real `totalCount` plus a removable chip per active filter (platform, brand) — clicking a chip's ✕ calls the exact same `updateParams` function the filter controls already use, so it's not a second code path. The "Brand (exact match)" label (already honest since Phase 7) is unchanged — still explicit that this is exact-match, not search, and still has no autocomplete since no brand-listing endpoint exists (Step 0 §21, re-confirmed unchanged).

## 7. Table design

Consolidated the previous 3 separate "Product"/"Platform"/"Brand" columns into one strong identity column (product ID as the primary link, platform + brand as a secondary line beneath it) — frees width for the metric columns and gives the row a clear "most important thing first" hierarchy, per the Step 3 brief's explicit ask. `aria-sort="descending"` was added to the actively-sorted metric column header — an honest annotation of the real, already-true order (the backend always sorts descending), not a claim that the header itself is a clickable sort control (sort mode is chosen via the existing Sort tabs). Row hover (`hover:bg-muted/50`, inherited from the shared `Table` primitive, unchanged) and the identity link's `hover:underline` remain the drill-down affordance — a full-row stretched-link was considered and deliberately not built, to avoid the accessible-name/test-fragility risk it introduces for a marginal gain over an already-clear identity link.

## 8. Mobile/tablet design

Built a genuine second layout, `RankingsCards.tsx` — not a horizontally-scrolling table (the exact anti-pattern flagged in the Step 0 audit §10). Each card shows the same real fields as the table (identity, platform, brand, the sort-appropriate metric set, trend/confidence badges) plus a real catalog position number (`#N`, arithmetic on the already-real `page`/`pageSize`/index — not a new ranking). Switching is a genuine conditional render (`useIsMobile()`, the same hook shadcn's own sidebar already uses, `MOBILE_BREAKPOINT = 768`) — **not** a CSS-hidden dual-render of both layouts, which would have doubled every field in the DOM and made every existing single-match test query ambiguous.

## 9. Accessibility

`aria-sort="descending"` on the real sorted column (§7). The Trend-score tooltip is reachable by hover and by keyboard focus (Radix `Tooltip` primitive). All new filter-chip remove buttons have explicit `aria-label`s (`"Remove platform filter (flipkart)"` etc.) rather than relying on visible ✕ text alone. Table semantics (`scope="col"` on every header) were already fixed app-wide in Phase 8 Step 1 and needed no re-work here. Color is never the only signal on any new element — every `StatusBadge` pairs icon + text + tone, unchanged discipline.

## 10. Performance behavior

Exactly one `getProductRankings` call per distinct query state — **UNIT-TEST PROVEN** (test 26: a benign UI-only re-render, triggered by hovering the tooltip, fires zero additional network requests). `placeholderData: keepPreviousData` on `useProductRankings` was already in place (Phase 7 Step 4) and is untouched. No new dependency was added (§14) — `RankingsCards` reuses the same `Card`/`StatusBadge`/`ConfidenceBadge` primitives already in the bundle. No AI call of any kind is made from this page (§11).

## 11. AI safety

`.../insights` is not imported, referenced, or called anywhere in `Products.tsx`, `RankingsTable.tsx`, or `RankingsCards.tsx` — confirmed by source inspection. Test 27 asserts no AI-related text renders on the page. `AI_PROVIDER` was not read or changed by any file this step.

## 12. Files created

- `frontend/src/components/intelligence/RankingsCards.tsx`
- `backend/scripts/phase8Step3RankingsRealDataValidation.ts` — kept as a permanent, rerunnable deliverable

## 13. Files modified

- `frontend/src/pages/Products.tsx` — results summary, filter chips, responsive switch (§4–§8)
- `frontend/src/components/intelligence/RankingsTable.tsx` — consolidated identity column, `trendDirection`, `aria-sort`, tooltip (§7)
- `frontend/tests/pages/Products.test.tsx` — `TooltipProvider` added to the render harness (§16), `useIsMobile` mocked, 9 new tests added
- `frontend/tests/setupTests.ts` — added a `ResizeObserver` polyfill (§16, a shared test-infrastructure gap, the same class of fix as the pre-existing `matchMedia` polyfill)

No backend, database, or AI configuration file was modified. (`backend/src/api/controllers/rankings.ts` was read but not edited — see §24 for why a real defect found there was deliberately left unfixed.)

## 14. Dependencies

**None added or removed.** `Tooltip`/`TooltipContent`/`TooltipTrigger` (already an installed shadcn primitive, already provided app-wide by `AppShell`'s `TooltipProvider`) and `useIsMobile` (already an existing hook, already used by the sidebar) both pre-existed. `git diff --stat` on `package.json`/`package-lock.json` shows no change.

## 15. Tests

**9 new tests, 242/242 total (PROVEN BY EXECUTION)** — 233 pre-Step-3 baseline + 9 new:
- Test 19: 401 → "Session expired" (the existing suite only had 403/500; added the missing case).
- Test 20: `sort=rating` shows the real `trendDirection` value.
- Test 21: the actively-sorted column carries `aria-sort="descending"`.
- Test 22: the Trend-score tooltip shows real explanatory text on hover.
- Test 23: filter chips render for active platform/brand filters and correctly clear via their own button.
- Test 24/25: the mobile card layout renders (no `<table>`, real `#1` position) when `useIsMobile()` is true, and the desktop table renders (no `#1` position) when it's false.
- Test 26: a benign UI-only interaction (hovering the tooltip) fires zero additional rankings requests.
- Test 27: no AI-related content renders on this page.

**No existing test was weakened.** All 18 pre-existing tests pass with their assertions completely unchanged — only the test file's render harness gained `TooltipProvider` (required once `RankingsTable` started rendering a real `Tooltip`, exactly the same class of fix Phase 8 Step 1/2 already applied to `routing.test.tsx`) and a `useIsMobile` mock (defaulted to `false`, i.e. desktop, so every pre-existing test continues exercising the exact same table path it always did).

## 16. Typecheck

`tsc -b`: clean (**PROVEN BY EXECUTION**).

## 17. Build size

**890.19 KB → 890.19 KB JS measured after this step vs. 884.89 KB at the end of Step 2** — a ~5.3 KB increase (263.59 KB → 264.40 KB gzip), **80.39 KB → 80.69 KB CSS**. Fully attributable to this step's own new component code (`RankingsCards.tsx`, the tooltip/chip/aria-sort additions); no new dependency was installed (§14), so none of the increase is third-party weight. The pre-existing >500 KB chunk-size warning still fires, unrelated to this step (code-splitting remains explicitly out of scope) (**PROVEN BY EXECUTION**).

## 18. Backend regression

**308/308 passing, unchanged.** Backend `tsc --noEmit`: clean. No backend file was modified this step (**PROVEN BY EXECUTION**).

## 19. Safety check

`npm run safety-check`: `OK — no write-shaped SQL found in database/prodReadOnly/` (**PROVEN BY EXECUTION**).

## 20. Real-data validation (PROVEN BY EXECUTION)

`backend/scripts/phase8Step3RankingsRealDataValidation.ts`, `AI_PROVIDER=mock` forced, against the real local dataset:

| Check | Result |
|---|---|
| `sort=health` | `totalCount=1004`; top real item `flipkart/777777` (`CtrlBrand`), `sortValue=100`; `severityScore`/`totalScore` confirmed `null` (script asserts, would throw otherwise); `trendScore` confirmed a real number |
| `sort=rating` | `totalCount=1004`; same top item, `sortValue=5`; `trendDirection` confirmed present on the real response |
| `platform=flipkart` | `totalCount=502` |
| `brand=<fabricated nonexistent name>` | `totalCount=0` — the real "no results" path |
| Pagination (`page=1` vs `page=2`, `sort=health`) | **See §24 — a real defect was found here, not fixed** |

Database confirmed byte-identical before/after (`normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`) — this endpoint is read-only, re-confirmed against real data.

## 21. Database safety

`ai_insights` count is **4** (up from 3 at the end of Phase 7 Step 9/Phase 8 Step 0), consistent with the already-documented pattern of your own live browser testing between steps generating additional real Gemini rows — not something this step or its validation script touched. The script's own before/after comparison on this run is identical (4 → 4), and it was independently re-confirmed by a second, separate read-only checksum query after the script's early defect-log (§24) to make sure no write had occurred despite that unusual code path. Zero writes.

## 22. AI call count

**Zero** from this step's own work. `AI_PROVIDER=mock` was forced during validation as defense-in-depth (this endpoint has no AI path at all — re-confirmed by source, §11).

## 23. Production access

None — this step never left the local dataset / frontend working tree.

## 24. Defects found/fixed — IMPORTANT, please read

**One real, pre-existing backend defect was discovered by this step's own real-data validation script. It was NOT fixed, because fixing it would require a backend code change, which is outside Step 3's frontend-only scope.**

**Finding:** `GET /v1/products/rankings?sort=health&page=1&pageSize=5` and the same request with `page=2` return an **overlapping** result: product `flipkart/777777` appears on both pages. Reproduced consistently across repeated runs (not a flaky/transient result). **Root cause (verified by reading `rankings.ts` again after the finding):** the backend's sort comparator (`(b.sortValue ?? -1) - (a.sortValue ?? -1)`) has **no secondary tiebreaker**, and there are more than 5 real products tied at the maximum `sortValue` of `100` in the current dataset. `Array.prototype.sort` in V8 is stable relative to its *input* array order, but that input order comes from an async catalog sweep (`computeCatalogHealthScores`) whose own product-by-product resolution order is not guaranteed identical across separate invocations/cache recomputes — so which tied products land in which page-boundary slot can differ between the `page=1` and `page=2` requests when the Category C cache entry underlying them is (re)computed at slightly different times.

**Why this was not fixed:** the fix belongs entirely in `backend/src/api/controllers/rankings.ts` (adding a deterministic secondary sort key, e.g. `sourceProductId`, to the comparator) — a backend change, explicitly forbidden by this step's strict scope. Per the master prompt's own stop conditions ("if required, backend modification becomes necessary... STOP"), this is flagged here rather than worked around.

**What was deliberately NOT done as a workaround:** no client-side de-duplication or re-sorting was added to mask this in the frontend — that would itself be exactly the kind of client-side ranking manipulation this step was told never to do, and it would hide a real data-integrity signal rather than surface it.

**Recommendation for you to decide on:** a future backend-touching step could add a stable secondary sort key (e.g., `sourceProductId` ascending) to `rankings.ts`'s comparator for both `sort=health` and `sort=rating`. This is a small, low-risk, purely-deterministic fix, but it is a backend change and is not authorized by Step 3's scope.

## 25. Known limitations

- The pagination-tie defect in §24 remains present in production behavior today — a user paginating through a catalog with many tied top scores could see the same product on two adjacent pages. Real but narrow: it only manifests among products tied at the exact same `sortValue`, which the real dataset shows only at the very top of `sort=health`'s ranking (`sortValue=100`).
- No page-size selector — unchanged from Phase 7 Step 4, still fixed at 20, still well within the backend's max of 100.
- No visual-regression/screenshot testing was performed. **NOT MEASURED**: real rendered appearance on an actual mobile device, real perceived-performance impact of the bundle-size change.

## 26. Open Engineering Dependencies

- A stable secondary sort key for `/v1/products/rankings` (§24) — **requires a backend change**, not authorized this step.
- Brand autocomplete/fuzzy search — unchanged from Step 0 §21, still blocked by the absence of any brand-listing endpoint.
- A per-product severity/priority visual ranking — unchanged, still blocked by the absence of an approved severity formula.

## 27. Evidence classification

- **PROVEN BY EXECUTION**: typecheck, full test suite (242/242), build output and byte deltas, backend regression (308/308), safety-check, the real-data validation script's exact output including the reproduced pagination defect, database before/after equality.
- **UNIT-TEST PROVEN**: table/card rendering, `aria-sort`, tooltip content, filter chips, no-duplicate-request, no-AI-content, `trendDirection` display.
- **OBSERVED**: the real catalog's real tied-score distribution (§24) and the real `ai_insights` count change (§21) are today's snapshot, independently re-verified this step.
- **NOT MEASURED**: real rendered visual appearance on an actual device, real user task-completion speed against the Step 0 UX bar.

---

**Phase 8 Step 3 is complete**, with one real, pre-existing backend defect discovered and explicitly left unfixed per scope (§24) — **please advise whether you'd like a future step authorized to fix it.**

No other page was touched. No backend, database, or AI provider was modified. No new dependency was added.

Waiting for your explicit approval before Step 4 (Product Detail transformation).
