# Phase 7 — Step 6 — Problems — Report

**Scope:** `/problems` (cross-product theme clustering) only, using only `GET /v1/problems`. No other page implemented. Backend, database, and AI provider configuration were not modified.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Pre-coding inspection

Before writing any code, re-read: `src/api/controllers/problems.ts` and `computeProblemsAggregate` in `src/modules/analytics/problemsAggregate.ts` (confirmed the response is a single grouped SQL aggregate, `ORDER BY count(*) DESC`, and deliberately emits no severity field — "severity.ts has no approved formula... nothing honest to compute for it, so no field is emitted"); `ProblemsQuerySchema` in `src/api/schemas.ts` (confirmed the only real query params are `window`, `platform`, `theme`); `ThemeSchema`/`THEME_VOCABULARY` in `src/database/appStore/models/reviewTheme.ts` (a fixed 11-value controlled vocabulary: `quality, size, fit, comfort, color, durability, packaging, delivery, value, material, product_mismatch`); `frontend/src/api/endpoints/problems.ts`, `useProblems` in `frontend/src/hooks/queries/useCategoryC.ts`, `frontend/src/types/api.ts` (`ProblemsResponse`, `ProblemThemeSummary` — confirmed **no product identifier, no evidence review ID, and no severity field exists anywhere on this type**); the Step 1 `Problems.tsx` stub; Dashboard/Rankings/Warnings implementations and the Step 5 report for consistent URL-filter and state-handling patterns.

**Key finding that shaped the whole design**: `ProblemThemeSummary` carries exactly `{ theme, mentionCount, distinctReviewCount, distinctProductCount, confidence }` — nothing else. There is no way to identify which specific products or reviews back a given theme row from this endpoint's response. This is a real, verified contract limitation, not an oversight — confirmed by reading `problemsAggregate.ts`'s SQL directly (it `GROUP BY rt.theme` catalog-wide with no per-product or per-review projection). Per your explicit instruction, no drill-down link was built. This did not require stopping to ask, since a meaningful page (a scannable, filterable cross-product theme table) is achievable without inventing anything.

## 2. Objective

Build a cross-product Problems investigation table showing every real field the backend returns, filterable by the three real supported parameters, with no fabricated severity or invented drill-down.

## 3. Files created

- `frontend/src/components/intelligence/ProblemsTable.tsx`
- `frontend/tests/pages/Problems.test.tsx` (18 tests)
- `backend/scripts/phase7Step6ProblemsRealDataValidation.ts` — kept as a permanent, rerunnable deliverable

## 4. Files modified

- `frontend/src/pages/Problems.tsx` — real implementation, replacing the Step 1 stub
- `frontend/src/hooks/queries/useCategoryC.ts` — added `placeholderData: keepPreviousData` to `useProblems`, matching the same addition already made to the other three Category C hooks in Steps 2/4/5

No backend, database, or AI configuration file was touched.

## 5. API endpoint consumed and exact contract verified

Exactly one: `GET /v1/problems`. Query params: `window` (`NamedWindowSchema`, default `30d`), `platform` (optional, `flipkart`/`myntra`), `theme` (optional, one of the 11 `THEME_VOCABULARY` values). Response: `{ window, cacheHit, filters: { platform: Platform | null, theme: Theme | null }, themes: ProblemThemeSummary[] }`, each theme row exactly `{ theme: string, mentionCount: number, distinctReviewCount: number, distinctProductCount: number, confidence: ConfidenceLevel }`. No AI endpoint is reachable from this page.

## 6. UI behavior

Window selector (existing `WindowSelector`), platform filter (`all`/`flipkart`/`myntra` tabs), theme filter (`all` + all 11 `THEME_VOCABULARY` values as a wrapping tab strip — the same real, fixed vocabulary the backend itself validates against, not an invented list) — all three round-trip through the URL following the established Rankings/Warnings pattern. Body is a `ProblemsTable` (new component, styled like the existing `RankingsTable`) with columns Theme / Mentions / Reviews / Products / Confidence, rendered in the exact order the backend returned (no client-side re-sort). No drill-down link column exists, since the response provides no product or evidence identifier to link to.

## 7. State handling

Loading (skeleton), error (`ErrorState` — 401 → "Session expired", 403 → "Not permitted", 500/network → generic with Retry), empty (`EmptyState`, "No recurring problems found for this period" — a real, distinct analytical result, not an error), `insufficient_data` confidence rendered honestly via the existing `ConfidenceBadge` — never hidden. All **UNIT-TEST PROVEN**.

## 8. Tests

**18/18 new tests passing**, covering: render, exact backend-returned theme value, exact backend-returned counts and confidence, backend order preserved (never re-sorted client-side), loading state, empty state, 401, 403, generic 500, retry re-issuing the request, honest handling of the response's nullable `filters` echo, `insufficient_data` confidence not hidden, zero drill-down links (contract has no product identifiers), window/platform/theme URL sync, no fabricated severity, no client-side analytics (exactly one API call, numbers match the backend exactly), exact query-parameter check (`window`/`platform`/`theme` only), and initial-URL-state respect.

**Full frontend suite: 147/147** (129 pre-Step-6 baseline + 18 new). No existing test was weakened.

One real defect caught during test-writing (not shipped): the theme filter tab strip statically renders all 11 `THEME_VOCABULARY` labels (e.g. "quality") regardless of load state, so an early draft's `findByText("quality")` used as a load-wait resolved immediately against the filter tab rather than the actual table — a false-positive proxy for "the query resolved," the same class of bug flagged in earlier Phase 7 steps (a static, always-rendered filter option this time, not a split text node or URL-derived value). Fixed by waiting on a table `cell` role instead, which only exists once real data has rendered.

## 9. Build/typecheck

Frontend `tsc -b`: clean. `npm run build`: succeeded (848.21 KB minified JS — the same pre-existing chunk-size advisory noted since Step 3, unrelated to this step, not addressed here).

## 10. Backend regression

**308/308 passing**. Backend `tsc --noEmit`: clean. `npm run safety-check`: OK. No backend file touched.

## 11. Real-data validation (PROVEN BY EXECUTION)

`backend/scripts/phase7Step6ProblemsRealDataValidation.ts`, `AI_PROVIDER=mock` forced (this endpoint has no AI path at all — verified by source, guard kept for consistency), against the real dataset:

| Query | Result |
|---|---|
| `window=30d` | `themes.length=10`, top 3 by mentions: `quality` (66 mentions / 66 reviews / 58 products, medium), `color` (49/49/46, medium), `delivery` (41/41/40, medium) |
| `platform=flipkart` | `themes.length=8` |
| `theme=quality` | `themes.length=1`, script asserts the single returned row's `theme === "quality"` (would throw otherwise) |

The script additionally asserts, against the real response (not synthetic test data): no `severity`/`severityScore`/`priority`-shaped field is present on any row (would throw `DEFECT` otherwise), and the real response is sorted by `mentionCount` descending exactly as `problemsAggregate.ts` documents (would throw otherwise). Neither threw.

## 12. Database before/after

Before: `normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`. After: identical, independently re-verified via direct SQL — this endpoint is confirmed read-only.

**`ai_insights` note**: the count is now **3**, not the **1** reported at the end of Step 5. This is not something Step 6 or its validation script produced — the script's own before/after count is identical (3 → 3). Direct inspection shows the original `myntra/100406` row is untouched (`created_at` unchanged, `2026-08-13T18:10:56.037Z`), plus two additional rows (`flipkart/FKPID000006` at `19:08:04`, `flipkart/FKPID000252` at `19:12:54`) — both timestamped after the backend dev server was restarted with the real `AI_PROVIDER=gemini` for your own live browser testing between Step 5 and Step 6. These are real Gemini-provider rows from your own interactive use of the app, not from any script or Step 6 code path.

## 13. AI call count

**Zero**, from Step 6 work itself. This page and its backend endpoint have no AI code path at all; `AI_PROVIDER=mock` was additionally forced during validation as defense in depth. (See §12 for the unrelated, expected count change from your own browser session.)

## 14. Production-access confirmation

No production database access.

## 15. Issues found and fixed

The theme-filter-tab test-timing issue described in §8 — a test-authoring defect, not a component defect. No product-code defects were found; the real-data validation script's structural assertions (no severity field, correct sort order) both passed on the first run.

## 16. Known limitations

- No drill-down from a theme row to the affected products or reviews — a real, verified limitation of the current `/v1/problems` contract (no product/evidence identifiers in the response), not an omission. Would require a backend contract change, which is out of scope for this step per your explicit instruction.
- The theme filter's 11 tabs can wrap to multiple lines on narrow viewports — acceptable, consistent with the Warnings signal-type filter's same wrapping treatment.
- The pre-existing chunk-size build warning (noted since Step 3) remains unaddressed.

## 17. Evidence classification summary

- **PROVEN BY EXECUTION**: typecheck/test/build results, backend regression, the real-data validation script's exact output, database before/after equality, the `ai_insights` row-identity check.
- **UNIT-TEST PROVEN**: every filter/state-handling/no-fabrication/no-drill-down claim in §6–§8.
- **OBSERVED**: the real catalog's real theme/count/confidence breakdown (§11) is today's snapshot.
- **NOT MEASURED**: real end-user perceived load latency in an actual rendered browser session.

---

**Phase 7 Step 6 is complete. Step 7 has NOT started.**
