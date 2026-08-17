# Phase 7 — Step 9 — System / Admin — Report

**Scope:** `/system` (System/Admin), using only `GET /v1/system/ingestion-status` and `GET /v1/system/ai-usage`. No other page implemented. Backend, database, and AI provider configuration were not modified (one frontend type correction was made — see §16).

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 0. Gap analysis (performed before any code change)

A read-only audit confirmed System/Admin is the sole remaining page: `docs/architecture/phase-7-frontend-architecture-design.md` §5 lists exactly 9 pages; Steps 1–8 implemented pages 1–8; a repo-wide scan for `StubPage` usage under `frontend/src/pages` found only `System.tsx` still a stub (`BrandsIndex.tsx` is the separate, already-flagged intentional extra landing page, not one of the original 9). §5 row 9 and its page-by-page design (§5, "9. System/Admin") explicitly describe "Two simple tables (`watermarks`, `runs`), admin-only route guard client-side too" backed by exactly `/v1/system/ingestion-status` and `/v1/system/ai-usage`. §20's three explicitly-deferred backend endpoints (`PATCH /v1/early-warnings/:id`, `.../insights/regenerate`, `/v1/analyst/query`) remain absent from `router.ts` and have no frontend surface — correctly still out of scope. No backend/database change or AI call is required. The full gap analysis was presented to you before implementation began; you did not need to redirect it.

## 1. Pre-coding inspection

Re-read: `src/api/controllers/system.ts` (`getIngestionStatus` — raw `SELECT * FROM ingestion_watermarks ORDER BY platform`; `getAiUsage` — raw `SELECT * FROM ai_processing_runs ORDER BY started_at DESC LIMIT 50`; neither has any write statement, neither imports any AI module); `src/api/router.ts` (both routes gated by `authenticate` + `adminOnly`, no query-schema validation on either — confirmed no query params are accepted, matching the architecture doc's own row for these endpoints); `frontend/src/api/endpoints/system.ts`, `useIngestionStatus`/`useAiUsage` in `frontend/src/hooks/queries/useSystem.ts` (both hooks already existed, pre-built with an `enabled` gate specifically documented as letting a caller "avoid firing a request that will just 403 for a non-admin role"); `frontend/src/types/api.ts` (`IngestionWatermarkRow`, `AiProcessingRunRow` — both already fully typed); the Step 1 `System.tsx` stub; the existing `SystemStatusBadge.tsx` component (built in Step 1, never used by a real page); `RequireRole.tsx` and `router.tsx` (confirmed `/system` is already wrapped in `<RequireRole roles={["admin"]}>`, done in Step 1 — not modified this step); `AuthProvider.tsx` for the real `role` claim source.

**RBAC verification (explicitly re-checked per your instruction)**: both routes use `adminOnly` middleware in `router.ts` — a stricter gate than the `anyRole` used by every other endpoint touched in Steps 2–8. Confirmed against the real running app in §12 (not just read from source): admin → 200, viewer/analyst → 403, no `Authorization` header → 401.

**`SystemStatusBadge` decision (flagged in the gap analysis, resolved here)**: its vocabulary (`healthy`/`warning`/`error`/`unknown`) doesn't correspond to either real backend enum — `ingestion_watermarks.status` is `"idle"|"running"`, `ai_processing_runs.status` is `"running"|"success"|"partial_failure"|"failed"`. Mapping either onto `SystemStatusBadge` would require an invented judgment call (e.g., classifying `partial_failure` as "warning" vs. "error"). Both real enums are instead rendered as their own literal value inside a plain `Badge`, colored 1:1 per real value (no threshold, no derived classification) — the same non-judgmental pattern `ConfidenceBadge`/`SignalBadge`/`MarketplaceBadge` already use for other real backend enums. `SystemStatusBadge` remains built but unused, same as `NoMappingState` was before Step 8.

## 2. Confirmed Step 9 scope

System/Admin only: `/system`, consuming exactly `GET /v1/system/ingestion-status` and `GET /v1/system/ai-usage`. No other page, no backend/database change, no AI call.

## 3. Files created

- `frontend/src/components/intelligence/IngestionWatermarksTable.tsx`
- `frontend/src/components/intelligence/AiUsageTable.tsx`
- `frontend/tests/pages/System.test.tsx` (20 tests)
- `backend/scripts/phase7Step9SystemAdminRealDataValidation.ts` — kept as a permanent, rerunnable deliverable

## 4. Files modified

- `frontend/src/pages/System.tsx` — real implementation, replacing the Step 1 stub
- `frontend/src/types/api.ts` — corrected `IngestionWatermarkRow.last_seen_source_id` from `number` to `string` (see §16 — a real defect discovered via this step's own real-data validation, not introduced by this step)

No backend, database, or AI configuration file was touched. `useSystem.ts`'s hooks needed no change — both already had the `enabled` gate this page uses.

## 5. Endpoints consumed

Exactly two: `GET /v1/system/ingestion-status`, `GET /v1/system/ai-usage`. Neither accepts any query parameter (confirmed: no `validateQuery` call wraps either route). No AI endpoint is reachable from this page.

## 6. RBAC behavior

Server-side (authoritative): both routes require `authenticate` + `adminOnly` — re-verified against the real running app in §12 (admin 200, viewer/analyst 403, unauthenticated 401). Client-side (UX only, not the security boundary): `/system` is wrapped in `<RequireRole roles={["admin"]}>` (already in place since Step 1, unmodified); this page additionally reads `role` from `useAuth()` and passes `enabled: role === "admin"` to both hooks, so a non-admin who somehow reached this component (e.g., a future routing bug) still never fires a request that would just 403. No dev-token issuance endpoint exists or was added. No JWT secret is ever held by the frontend (confirmed unchanged — this page doesn't touch tokens at all; auth headers are attached elsewhere via the existing API client). All **UNIT-TEST PROVEN** (§9) and **PROVEN BY EXECUTION** (§12, against the real backend).

## 7. UI behavior

Header ("System / Admin") plus two independent sections, each with its own loading/error/empty state so one section's failure never blocks the other: "Ingestion status" (`IngestionWatermarksTable` — one row per platform, in the backend's own `ORDER BY platform`) and "AI usage" (`AiUsageTable` — up to 50 rows, in the backend's own `ORDER BY started_at DESC`, never re-sorted client-side). No navigation beyond the existing sidebar (no "back" link needed — `/system` is a top-level nav destination, not a drill-down page, consistent with Dashboard/Rankings/Warnings/Problems).

## 8. State handling

Loading (skeleton, per section), error (`ErrorState` — 401 → "Session expired", 403 → "Not permitted" — this is a real backend denial, distinct from and independent of the client-side `RequireRole` gate — 500/network → generic with Retry, all per section), empty (`EmptyState`, per section — "no watermarks recorded yet" / "no AI processing runs yet," real, honest results, not errors). Null fields (`last_reconciliation_run_at`, `last_reconciliation_rows_scanned`, `last_reconciliation_rows_changed`, `lock_acquired_at`, `finished_at`, `duration_ms`, `platform` on a run) render as `—`, never a fabricated value. `duration_ms` is shown as raw milliseconds (no unit conversion/derived rate) to stay strictly within "display backend values exactly." All **UNIT-TEST PROVEN**.

## 9. Tests

**20/20 new tests passing**, covering: successful admin render, both real sections present, exact backend-returned watermark values, exact backend-returned AI-usage run values, loading state, independent empty states for each section, null-field honesty (≥6 real dashes across both sections), 401 (both sections independently), 403 (a real backend denial), generic 500, retry, admin route access (via `RequireRole`), viewer denial with zero admin-only requests fired, analyst denial with zero admin-only requests fired, unauthenticated (`role: null`) denial, exact request shape (both endpoints called with no query params), no fabricated status vocabulary (`SystemStatusBadge`'s "Healthy"/"Warning" never appear; only the real literal enum values do) and no fabricated dollar-cost figure, no client-side calculation (raw `duration_ms` shown unconverted), backend order preserved (no client re-sort), and no raw `Bearer` token ever rendered in the DOM.

**Full frontend suite: 205/205** (185 pre-Step-9 baseline + 20 new). No existing test was weakened. The pre-existing `routing.test.tsx` checks for `/system` (admin renders "System / Admin", sidebar shows/hides the System nav item by role, a viewer sees "Not permitted") needed **no update** — unlike Steps 7/8's Brand/Product Comparison stubs, the Step 1 stub's title text ("System / Admin") was already identical to the real page's `<h1>`, so those assertions kept passing unmodified.

## 10. Build/typecheck

Frontend `tsc -b`: clean. `npm run build`: succeeded (865.34 KB minified JS — the same pre-existing chunk-size advisory noted since Step 3, unrelated to this step, not addressed here).

## 11. Backend regression

**308/308 passing**. Backend `tsc --noEmit`: clean. `npm run safety-check`: OK. No backend file touched.

## 12. Real-data validation (PROVEN BY EXECUTION)

`backend/scripts/phase7Step9SystemAdminRealDataValidation.ts`, `AI_PROVIDER=mock` forced (neither endpoint has any AI path — verified by source, guard kept for consistency), against the real dataset:

| Check | Result |
|---|---|
| `admin GET /v1/system/ingestion-status` | `status=200`, 2 real watermark rows (`flipkart`: `last_seen_source_id="50007"`, `status="idle"`, 20,016 rows scanned last reconciliation, 0 changed; `myntra`: `last_seen_source_id="50002"`, `status="idle"`, 20,079 rows scanned, 0 changed) |
| `admin GET /v1/system/ai-usage` | `status=200`, 7 real runs — script asserts the count is ≤ the documented 50-row bound (would throw `DEFECT` otherwise) |
| `viewer GET /v1/system/ingestion-status` | `status=403` — script asserts this exactly (would throw `DEFECT` otherwise) |
| `analyst GET /v1/system/ai-usage` | `status=403` — same assertion |
| no `Authorization` header | `status=401` — same assertion |

## 13. Database before/after

Before: `normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`, `ai_insights=3`, `product_family_mapping=0`, `ingestion_watermarks=2`, `ai_processing_runs=7`. After: byte-identical on all six, independently re-verified via direct SQL — both endpoints are confirmed read-only (they were already `SELECT`-only by source inspection; this proves it against the live database too).

## 14. AI call count

**Zero.** Neither endpoint has any AI code path; `AI_PROVIDER=mock` was additionally forced during validation as defense in depth.

## 15. Production-access confirmation

No production database access.

## 16. Defects found and fixed

One real, pre-existing defect found via this step's own real-data validation (not introduced this step): `IngestionWatermarkRow.last_seen_source_id` was typed `number` in `frontend/src/types/api.ts` since an earlier phase, but the real API returns it as a **string** — `ingestion_watermarks.last_seen_source_id` is a Postgres `BIGINT` column (confirmed in `backend/src/database/appStore/models/ingestionWatermark.ts`), and the `pg` driver serializes `BIGINT` as a string by default to avoid precision loss beyond `Number.MAX_SAFE_INTEGER`. The real validation run's output (`last_seen_source_id: '50007'`, quoted — a string) exposed this. It never caused a runtime error (the value was only ever interpolated directly into JSX, never used arithmetically — confirmed by grep before changing it), but the type was wrong. Fixed by correcting the type to `string`, with a comment explaining why. No other file needed a change as a result.

## 17. Known limitations

- `AiUsageTable` shows a curated set of `ai_processing_runs` columns (job ID, platform, provider/model, status, candidate/processed/success/failure/retry counts, started/finished, duration) rather than every raw column (e.g., `dry_run`, `already_classified_count`, `stale_count`, `new_count` are not shown) — a presentational choice for table width, not a data omission; every field shown is the exact real value, and no shown field is derived from an unshown one.
- No pagination/filtering UI for AI usage beyond the backend's own fixed 50-row bound — none is needed since the backend enforces that bound itself and no query parameter exists to request more.
- The pre-existing chunk-size build warning (noted since Step 3) remains unaddressed.

## 18. Evidence classification summary

- **PROVEN BY EXECUTION**: typecheck/test/build results, backend regression, the real-data validation script's exact output (including the real RBAC responses and the real `last_seen_source_id` string type), database before/after equality.
- **UNIT-TEST PROVEN**: every state-handling/RBAC/no-fabrication claim in §6–§9.
- **OBSERVED**: the real ingestion watermarks and AI-usage runs (§12) are today's snapshot.
- **NOT MEASURED**: real end-user perceived load latency in an actual rendered browser session.

---

**Phase 7 Step 9 is complete. Phase 8 has NOT started.**
