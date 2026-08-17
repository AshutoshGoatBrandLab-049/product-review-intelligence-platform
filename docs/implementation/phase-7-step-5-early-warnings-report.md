# Phase 7 — Step 5 — Early Warnings — Report

**Scope:** `/warnings` (Early Warnings) only, using only `GET /v1/early-warnings`. No other page implemented. Backend, database, and AI provider configuration were not modified.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Pre-coding inspection

Before writing any code, re-read: `src/api/controllers/earlyWarnings.ts` and `EarlyWarningsQuerySchema` in `src/api/schemas.ts` (confirmed the only real query params are `window`, `platform`, `brand` — no server-side `signalType` filter exists); `frontend/src/api/endpoints/earlyWarnings.ts`, `frontend/src/hooks/queries/useCategoryC.ts` (`useEarlyWarnings` already has `placeholderData: keepPreviousData` from Step 2, no change needed); `frontend/src/types/api.ts` (`EarlyWarningsResponse`, `EarlyWarningSignal` — confirmed no `severityScore`/`totalScore` field exists on this type at all); Dashboard's existing "Active Early Warnings" section (Step 2) and `splitSignalsByReadiness` (`frontend/src/lib/signals.ts`, extracted in Step 3); `EarlyWarningCard.tsx` (reused unmodified).

## 2. Objective

Build a catalog-wide investigation surface at `/warnings` — richer than Dashboard's compact panel — using only the real API contract, with honest, non-hidden confidence/readiness states.

## 3. Files created

- `frontend/tests/pages/Warnings.test.tsx` (16 tests)
- `backend/scripts/phase7Step5WarningsRealDataValidation.ts` — kept as a permanent, rerunnable deliverable

## 4. Files modified

- `frontend/src/pages/Warnings.tsx` — real implementation, replacing the Step 1 stub

No backend, database, or AI configuration file was touched. `useCategoryC.ts` needed no change (`useEarlyWarnings` already had `keepPreviousData` from Step 2).

## 5. API endpoints consumed

Exactly one: `GET /v1/early-warnings`. No AI endpoint is reachable from this page.

## 6. UI / filtering

Window selector, platform filter (`all`/`flipkart`/`myntra`), brand filter (exact-match, explicit "Apply"/"Clear", matching the Rankings pattern) — all three are the real backend-supported filters and round-trip through the URL. A signal-type filter tab strip is layered on top of the already-fetched `active` signals: its options and per-type counts are derived only from signal types actually present (never a hardcoded list, never includes `product_deterioration` since it can never be active) — this is presentational grouping of real data, the same pattern already used by `notReadyGroups`, not a new analytics computation. `not_ready` signals are kept in a separate "Not Available Yet" panel, grouped by type with a count, never mixed into or counted among active warnings. Two distinct empty states exist: zero active warnings for the period vs. zero warnings matching the current signal-type filter, so the two real, different situations are never conflated.

## 7. State handling

Loading (skeleton), error (`ErrorState`, distinguishing 401/403 "Not permitted" from generic 500), empty (`EmptyState`), `insufficient_data` and `not_ready` both rendered honestly via the existing `ConfidenceBadge`/`SignalBadge` — never hidden, never merged with each other — all **UNIT-TEST PROVEN**.

## 8. Tests

**16/16 new tests passing**, covering: render, real current/baseline/delta/threshold values, all 5 real active-capable signal types via `SignalBadge`, all confidence states, `not_ready` separation into its own panel (never rendered as an active warning), `insufficient_data` handled honestly, empty active-warning state, loading state, 401/403, generic 500, product drill-down link correctness, window selection + URL sync, platform/brand filtering + URL sync, no fabricated `severityScore`/`totalScore` anywhere on the page, the signal-type filter as pure client-side grouping (asserted via exactly one API call total across a filter interaction), and an exact query-parameter check (`window`/`platform`/`brand` only — no invented fields).

**Full frontend suite: 129/129** (113 pre-Step-5 baseline + 16 new). No existing test was weakened.

One real defect caught during test-writing (not shipped): `EarlyWarningCard` renders `{signal.platform} · {signal.sourceProductId}` as a single combined text node, so exact-string `getByText("PID001")` queries failed even though the component was correct — fixed by using substring/regex matchers in the test, matching the Step 1 "text split across DOM nodes" lesson (same class of issue, different cause — combined node vs. split node).

## 9. Build/typecheck

Frontend `tsc -b`: clean. `npm run build`: succeeded (844.89 KB minified JS — the same pre-existing chunk-size advisory noted since Step 3, unrelated to this step, not addressed here).

## 10. Backend regression

**308/308 passing**. Backend `tsc --noEmit`: clean. `npm run safety-check`: OK. No backend file touched.

## 11. Real-data validation (PROVEN BY EXECUTION)

`backend/scripts/phase7Step5WarningsRealDataValidation.ts`, `AI_PROVIDER=mock` forced (this endpoint has no AI path at all — verified by source, guard kept for consistency), against the real dataset:

| Query | Result |
|---|---|
| `window=30d` | `productsScanned=1004`, `signals.length=1387` |
| confidence breakdown | `{ not_ready: 1004, low: 219, insufficient_data: 34, medium: 130 }` |
| signalType breakdown | `{ product_deterioration: 1004, sudden_negative_review_increase: 103, review_volume_spike: 42, persistent_negative_trend: 149, sudden_rating_decline: 83, complaint_spike: 6 }` |
| `platform=flipkart` | `signals.length=701`, script asserts every returned signal's `platform === "flipkart"` (would throw otherwise) |
| `brand=<fabricated nonexistent name>` | `signals.length=0` — the real "no results" path, not simulated |

The script additionally asserts, against the real sweep (not synthetic test data), that `product_deterioration` never appears with any confidence other than `not_ready` — it would throw `DEFECT: product_deterioration fired as an active signal` otherwise. It did not throw.

## 12. Database before/after

Before: `normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`, `ai_insights=1`. After: identical, independently re-verified via direct SQL. The single `ai_insights` row is confirmed still `myntra/100406`, `created_at` unchanged (`2026-08-13T18:10:56.037Z`) — the pre-existing real Gemini-provider row from Step 3, untouched.

## 13. AI call count

**Zero.** This page and its backend endpoint have no AI code path at all; `AI_PROVIDER=mock` was additionally forced during validation as defense in depth.

## 14. Production-access confirmation

No production database access. The pre-existing real `ai_insights` row remains exactly as it was.

## 15. Issues found and fixed

The `EarlyWarningCard` combined-text-node test-matching issue described in §8 — a test-authoring defect, not a component defect. No product-code defects were found.

## 16. Known limitations

- The signal-type filter's option order (`countsByType`, sorted by descending count) can reorder as the underlying data changes between window/filter changes — acceptable for a presentational summary, not a stability guarantee.
- No signal-level acknowledgment/dismissal — the real API has no such write path (`PATCH /v1/early-warnings/:id` was never built, consistent with Phase 5's compute-on-demand decision), so none is offered here.
- The pre-existing chunk-size build warning (noted since Step 3) remains unaddressed.

## 17. Evidence classification summary

- **PROVEN BY EXECUTION**: typecheck/test/build results, backend regression, the real-data validation script's exact output, database before/after equality, the `ai_insights` row identity check.
- **UNIT-TEST PROVEN**: every filter/state-handling/no-fabrication claim in §6–§8.
- **OBSERVED**: the real catalog's real signal/confidence/type breakdown (§11) is today's snapshot.
- **NOT MEASURED**: real end-user perceived load latency in an actual rendered browser session.

---

**Phase 7 Step 5 is complete. Step 6 has NOT started.**
