# Phase 6 — API Layer — Implementation Report

**Scope:** a thin, read-only (v1) HTTP API over Phase 3/4/5's existing analytics/AI functions, with JWT+RBAC auth, request validation, rate limiting, an in-process Category C cache, and a minimal persisted AI-insights cache. No frontend, no write endpoints, no production access, no real Gemini/Anthropic calls — confirmed throughout (§8).

Status vocabulary, same discipline this project has used since Phase 5: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. What was built, by step

| Step | Deliverable |
|---|---|
| 0 | Baseline + architecture verification — found the original Phase 2 API design (`phase-2-technical-architecture.md` §17-19) still assumed precomputed serving tables that Phase 3/5 had already replaced with compute-on-demand functions; found `express`/`cors`/`helmet` already installed but completely unused; found `docs/api/` empty. |
| 1 | Design (`docs/architecture/phase-6-api-architecture-design.md`) — full function inventory (§1A), Category A/B/C performance classification (§1B), a reconciled 11-endpoint contract (§3), and an explicit KEEP-OUT/NEEDS-DECISION classification for every old Phase 2 serving table (§4). |
| 2 | Implementation — JWT+RBAC auth, request validation, rate limiting, error mapping, in-process Category C cache, persisted AI-insights cache, all 11 approved endpoints, 55 new tests. Plus a dedicated verification pass (Cases A-D on AI cache invalidation, cache-key audit, thin-layer audit, auth audit) — 5 more tests. |
| 3 | Real ~100K-dataset validation — every endpoint exercised against real data with real JWTs, real Category C cache miss/hit timings, the one write-capable endpoint (`/insights`) proven end-to-end then cleaned up so the real `ai_insights` table returned to empty. |
| 4 | This report. |

---

## 2. Endpoints delivered

Exactly the 11 approved GET endpoints — no more, no less:

`GET /v1/products/:platform/:sourceProductId[/signals|/insights]`, `GET /v1/brands/:brand/compare`, `GET /v1/products/family/:familyId/compare`, `GET /v1/early-warnings`, `GET /v1/dashboard/executive`, `GET /v1/products/rankings`, `GET /v1/problems`, `GET /v1/system/{ingestion-status,ai-usage}`.

**Deliberately not built** (per your standing instruction, unchanged across every step): `PATCH /v1/early-warnings/:id`, `POST /v1/products/:key/insights/regenerate`, `POST /v1/analyst/query`.

Every controller is a thin delegator to an existing Phase 3/4/5 function — **UNIT-TEST PROVEN** and independently re-audited in Step 2's verification pass. The one exception found and reported (not silently fixed): `dashboard.ts` computes `averageRatingScore` (a plain arithmetic mean) directly in the API layer, since no existing analytics function returns a catalog-wide average. Still true, still unchanged, per your explicit instruction this step.

---

## 3. Auth & security

JWT + RBAC, 3 roles (`admin`/`analyst`/`viewer`), verification fully isolated in `middleware/authenticate.ts` — **grep-confirmed** no controller ever imports the JWT module or inspects a token directly. `/v1/system/*` requires `admin`; the other 9 endpoints accept any authenticated role. No login/token-issuance HTTP endpoint exists — tokens come from `scripts/issueDevToken.ts`, a CLI-only tool never imported by the router (**grep-confirmed**), deliberately swappable for a real identity provider later without touching any controller. `JWT_SECRET` has no default and is never logged (**grep-confirmed** — only a code comment mentions the name); the server refuses to boot with an empty secret (`assertJwtSecretConfigured`, called only from `server.ts`, never at module load, so every non-API script stays unaffected).

Request validation (`api/schemas.ts`, Zod) runs before every controller; SQL-injection-shaped input is proven inert (**UNIT-TEST PROVEN**, parameterized `replacements` throughout — no controller or analytics function builds SQL by string concatenation). Rate limiting is a global `express-rate-limit` instance ahead of auth (so even invalid-token floods are throttled), env-configurable, with a dedicated isolated-instance test proving real 429 behavior without coupling to the shared app's limiter.

---

## 4. Category C caching

One in-process `TtlCache`, 60-second default TTL — **not** a guess: derived from a real full-catalog (1,004 products) benchmark (`scripts/phase6CategoryCBenchmark.ts`, kept as a permanent, rerunnable deliverable):

| Operation | Real measured time |
|---|---|
| `computeHealthScore` × full catalog (concurrency=5, matching the DB pool default) | 1,100.9ms |
| `computeProductAnalytics` × full catalog | 451.4ms |
| `detectAllProductSignals` (1,387 signals across 1,004 products) | 1,730.6ms |
| `computeProblemsAggregate` (single grouped query) | 197.0ms |

Re-confirmed at real HTTP scale in Step 3: dashboard executive (which internally also runs the early-warnings sweep for `activeAlertCount`) miss **2,257.5ms** → hit **3.1ms** (~728× speedup); rankings miss 651.5ms → hit 2.3ms. Cache keys are namespaced per route + every filter that affects the result (sort/window/platform/brand for rankings; window/platform/theme for problems); pagination is deliberately excluded from the rankings key since it's a pure post-cache slice, not part of what's computed. Dashboard and early-warnings intentionally share one cache key per window — **PROVEN BY EXECUTION** in Step 3 (a real early-warnings call showed `cacheHit:true` on its very first request, because the preceding dashboard call for the same window had already warmed the shared entry).

Known, disclosed limitation, never hidden: this is a per-process cache. A future multi-instance deployment would not share entries across instances — acceptable today since the hosting-target decision is still open (§26 of the original Phase 2 doc, never resolved in any phase).

---

## 5. AI insights persistence

`ai_insights` (migration 013) — the only new table this phase introduces, additive-only, no `ALTER TABLE` anywhere. Keyed on `(platform, source_product_id, window_start, window_end, input_hash)`; `input_hash` is a SHA-256 (same primitive/pattern `contentHash.ts` already uses, not a new mechanism) over every evidence-package field that could change the narration.

**Cache invalidation proven, not asserted** (Step 2's dedicated verification pass, 5 tests):
- **Case A** — identical repeated request: 1 row, second call is a pure hit, zero additional provider calls.
- **Case B** — real underlying data change (new reviews ingested): a genuinely new `input_hash`, a second distinct row, the old row untouched, and the *new* row served on the next identical request — never a stale answer reused.
- **Case C** — two different products with byte-identical review content never collide (including across platforms with the same `sourceProductId` string).
- **Case D** — the full `NarratorResult` contract (summary, rootCause, recommendations, rejectedCitations, irrelevantCitations, droppedUnsupportedClaims, citedMetrics, ungroundedMetrics) round-trips through the JSONB store intact.

Only **validated** narrator output is ever persisted — `getOrGenerateProductInsight` calls `narrateProductEvidence` (Phase 4/4.1's existing schema/citation/numeric-grounding validation), never raw provider output.

**Remaining, unchanged finding:** `model_version` is persisted as a separate column but is not part of `NarratorResult`'s contract, so it isn't in the HTTP response body. Not touched this phase, per your explicit instruction.

---

## 6. Real-dataset validation (Step 3, PROVEN BY EXECUTION)

All 11 endpoints exercised against the real ~100K dataset with real signed JWTs (mock AI provider only, guarded at runtime — see §8). Real brand picked live from the data ("Palecove", 67 products — consistent with the same brand Phase 5 Step 8 independently found). Family compare honestly returned `available:false, reason:"no_mapping"` (the mapping table is still empty, as designed). The one write-capable endpoint left the real database in exactly its documented state afterward, verified programmatically (the script's own before/after checksum equality check, not just eyeballed output).

---

## 7. Tests

**308/308 passing** — 248 pre-Phase-6 baseline + 60 new (55 from Step 2's implementation, 5 from Step 2's dedicated AI-cache-invalidation verification pass). One pre-existing test predictably updated (migration count 12→13, plus the new table added to the expected-table list) — the same, now-familiar pattern every migration-adding step in this project has produced. No existing test was weakened.

| Area | File | Tests |
|---|---|---|
| Auth/RBAC | `apiAuth.test.ts` | 9 |
| Validation + injection safety | `apiValidationAndInjection.test.ts` | 10 |
| Endpoint contracts + wiring | `apiContracts.test.ts` | 13 |
| Category C cache | `apiCategoryCCache.test.ts` | 5 |
| AI cache (basic) | `apiAiInsightsCache.test.ts` | 3 |
| AI cache invalidation (Cases A-D) | `apiAiInsightsCacheInvalidation.test.ts` | 5 |
| Error mapping | `apiErrorMapping.test.ts` | 12 |
| Rate limiting | `apiRateLimit.test.ts` | 3 |

---

## 8. Confirmations

```
PRODUCTION DATABASE ACCESSED:        NO
PRODUCTION TABLES MODIFIED:          NONE
PRODUCTION TABLES CREATED:           NONE
PRODUCTION DATA MODIFIED:            NONE
REAL/PRODUCTION AI PROVIDER CALLED:  NO, ZERO CALLS — every test uses AI_PROVIDER=mock
                                      (grep-confirmed, the only value ever set in tests/);
                                      the real-dataset validation script carries a HARD
                                      RUNTIME GUARD refusing to run unless
                                      config.ai.provider === "mock" — this caught a real
                                      near-miss during Step 3's own construction (the real
                                      .env has AI_PROVIDER=gemini set) before any request
                                      was ever made. Guard confirmed still present and
                                      unweakened this step (grep-verified).
DataWarehouse.flipkart_reviews / myntra_reviews: READ ONLY throughout Phase 6.
gbl_data_lake's product_review_intelligence schema (this platform's own local app store,
                                      not the read-only production source): received
                                      migration 013 (additive) and, during Step 3's
                                      validation, one transient ai_insights row — deliberately
                                      deleted before the script exited, verified back to 0.
```

Final regression state (re-confirmed fresh for this report, not carried forward): `npx tsc --noEmit` clean · `npm test` **308/308 passing** · `npm run safety-check` OK.

Real dataset, before vs. after Phase 6 in its entirety: `normalized_reviews=100,006`, checksum `821903ac625da7ee6256e2b6344ce868`, `review_sentiment=5,035`, `review_theme=8,933`, `product_dimension=1,004`, `product_daily_metrics=79,369`, `product_family_mapping=0` — all byte-identical to the pre-Phase-6 baseline. `ai_insights=0` (the only schema addition, confirmed empty).

---

## 9. Known limitations / remaining findings (consolidated, none resolved this phase)

- `dashboard.ts`'s `averageRatingScore` is computed in the API layer (plain arithmetic mean), not delegated to an existing analytics function — flagged in Step 2's verification pass, still true.
- `model_version` is persisted but not exposed in the `/insights` response — flagged in Step 2's verification pass, still true.
- Category C cache is per-process — won't share state across a future multi-instance deployment.
- No job queue exists — `POST .../insights/regenerate` and any future async work remain out of scope until an endpoint actually needs one.
- Auth is JWT+RBAC with no real identity provider behind it yet — `scripts/issueDevToken.ts` is a deliberate, disclosed stand-in, not a production authentication mechanism.
- The three deferred endpoints (ack/resolve, regenerate, analyst query) remain unbuilt, exactly as instructed every step.
- No frontend exists — Phase 6 delivered API only, as scoped.

---

## GO / NO-GO

**GO for Phase 6's actual delivered scope**: a complete, thin, read-only v1 API over the existing analytics/AI layer, with real auth/RBAC, real rate limiting, a real evidence-based cache, a real persisted AI-insights cache with proven invalidation semantics, comprehensive test coverage, and validation against the real ~100K dataset with zero real AI calls and zero lasting database drift.

**Not a GO for any production-readiness or frontend-integration claim** — auth has no real identity provider, the API has never been exposed outside this local environment, and the two carried-forward findings (§9) remain open judgment calls for you, not resolved unilaterally.

---

**Stopping here. Not starting Step 5, frontend, deployment, or any further scope — waiting for your explicit approval.**
