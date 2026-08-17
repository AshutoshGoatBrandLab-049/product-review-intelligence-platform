# Phase 7 — Frontend Intelligence Dashboard — Architecture Design

**Status:** Design only. No frontend code, dependencies, or files were created. `frontend/` remains empty. No backend, database, or API code was touched.

Status vocabulary, per instruction: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Executive summary

Phase 6 delivered a complete, tested, real-data-validated read-only API (11 GET endpoints, JWT+RBAC, Category C caching, persisted AI-insights caching — `docs/implementation/phase-6-api-implementation-report.md`). Phase 7 builds the dashboard that consumes it. This document is Step 0: a read-only inspection of (a) what exists in the repo today, (b) exactly what the API actually returns (read from the live controller/schema code, not the report's prose), and (c) a proposed information architecture, component/library strategy, and open-decision list — nothing implemented yet.

**Headline finding: the frontend framework, component library, chart library, state/query library, hosting target, and visual theme are all completely undecided.** `frontend/` has zero files, no `.gitignore` entries for any frontend tooling, no root `package.json`, no root `tsconfig.json`. Nothing in this repository commits to React, Vue, Next.js, or anything else — every one of those choices is listed as an open decision in §21, not assumed.

---

## 2. Current repository/frontend state (OBSERVED, verified this step)

| Item | State |
|---|---|
| `frontend/` directory | Exists, **zero files** (`ls -la` shows only `.`/`..`) |
| Root `package.json` | Does not exist |
| Root `tsconfig.json` | Does not exist |
| Lockfiles in the repo | Only `backend/package-lock.json` (npm) |
| `.gitignore` | Only backend entries (`backend/node_modules/`, `backend/dist/`, `backend/coverage/`, `backend/.env*`) — **no frontend entries at all** |
| Frontend dependencies anywhere | None |
| Frontend TypeScript config | None |
| Frontend lint/format config | None (no `.eslintrc*`, `eslint.config.*`, `.prettierrc*` anywhere in the repo, including backend) |
| Frontend build tooling | None (no Vite/webpack/Next config) |
| Styling libraries | None |
| Chart libraries | None |
| Component libraries | None |
| Icon libraries | None |
| Frontend test tooling | None |
| Node version | v24.16.0 (`node --version`, this machine) — informative for engine-range decisions later, not a repo commitment |
| README's stated project structure | `frontend — Product intelligence dashboard` — names the purpose, not a framework |

**Conclusion: this is a genuine greenfield frontend.** Nothing here narrows the framework choice; every recommendation below is a proposal for §21, not a finding.

---

## 3. Phase 6 API contract inventory (read from `src/api/router.ts`, `schemas.ts`, and every controller directly, this step — not from the report)

All 11 routes require `Authorization: Bearer <jwt>`; all return JSON; all errors use the shape `{ error: { code, message, ...extra } }` (`src/api/middleware/errorHandler.ts`). Roles: `admin`/`analyst`/`viewer` accepted on 9 routes; `/v1/system/*` requires `admin` only.

| Endpoint | Purpose | Inputs | Response shape | Loading | Empty | Error | Special state |
|---|---|---|---|---|---|---|---|
| `GET /v1/products/:platform/:sourceProductId` | Single product analytics + health | path: `platform` (`flipkart`\|`myntra`), `sourceProductId`; query: `window` (`7d`\|`30d`\|`60d`\|`90d`\|`6m`\|`12m`, default `30d`) | `{platform, sourceProductId, window, analytics: ProductAnalytics, health: HealthScore}` | spinner/skeleton | product has 0 reviews → `analytics.recentMetrics.totalReviews:0` | 400 bad platform/window, 401/403, 500 | `analytics.recentMetrics.confidence` can be `"insufficient_data"`; `health.severityScore`/`health.totalScore` are **always `null`** (no formula exists — never render as 0) |
| `GET /v1/products/:platform/:sourceProductId/signals` | Early-warning signals for one product | same params | `{platform, sourceProductId, window, signals: EarlyWarningSignal[]}` | spinner | `signals: []` is valid (nothing fired) | same as above | `product_deterioration` is **always present with `confidence:"not_ready"`** — must be rendered as "not available," never omitted or shown as a real signal |
| `GET /v1/products/:platform/:sourceProductId/insights` | AI summary/root-cause/recommendations | same params | `{platform, sourceProductId, window, cacheHit: boolean, insight: NarratorResult}` | **this call can be slow on a cache miss** (real AI provider latency, unmeasured here — see §19 performance) | n/a (always returns a structured object) | same + AI-provider errors map to 502/503 with `{error:{code:"ai_*", retryable, retryAfterMs}}` | `insight.rootCause`/`insight.recommendations` can be empty arrays (no grounded evidence found) — must render as "no strong finding," never fabricate one |
| `GET /v1/brands/:brand/compare` | Brand-level Flipkart vs Myntra | path: `brand`; query: `window` | Full `BrandMarketplaceComparison`: `{brand, window, flipkart: BrandAnalytics, myntra: BrandAnalytics, ratingComparison: PeriodComparison, themeConsistency: ThemeConsistencyResult[]}` | spinner | a brand with 0 reviews on both sides still returns a full shape, all-null/zero | same | Each `themeConsistency[i].classification` is `"marketplace_consistent"` \| `"marketplace_specific"` \| `"insufficient_evidence"` — **three distinct states, must be visually distinct, never collapsed into a binary** |
| `GET /v1/products/family/:familyId/compare` | Product-level cross-marketplace comparison (gated) | path: `familyId` (UUID); query: `window` | `{available:true, familyId, flipkart, myntra, ratingComparison, ...}` **OR** `{available:false, familyId, reason:"no_mapping"}` | spinner | n/a | 400 invalid UUID, 401/403 | **`product_family_mapping` is empty in both the real and every test database today (PROVEN BY EXECUTION, Phase 5/6) — every real `familyId` will currently return `available:false`.** The UI must handle this as the expected default, not an error, and should not be reachable without a real mapping ID to test against (none exist) |
| `GET /v1/early-warnings` | Catalog-wide open signals | query: `window`, `platform?`, `brand?` | `{window, cacheHit, filters, productsScanned, signals: EarlyWarningSignal[]}` | Category C — first call can take **up to ~1.7s at real catalog scale** (PROVEN BY EXECUTION, Step 3), cached 60s after | `signals: []` valid | same | Same `not_ready`/`insufficient_data` handling as single-product signals, at catalog scale |
| `GET /v1/dashboard/executive` | Org-wide summary | query: `window` | `{window, cacheHit, productCount, activeAlertCount, averageRatingScore: number\|null, topMovers: [...], bottomMovers: [...]}` | Category C — first call **~2.3s at real scale** (PROVEN BY EXECUTION), cached 60s | `productCount:0` possible on an empty catalog | same | `averageRatingScore` is `null` if zero products have a rating — must not render as "0" |
| `GET /v1/products/rankings` | Sortable/paginated product list | query: `window`, `sort` (`health`\|`rating`, default `health`), `platform?`, `brand?`, `page` (default 1), `pageSize` (default 20, max 100) | `{window, cacheHit, sort, page, pageSize, totalCount, items: [...]}` | Category C, cached per sort/window/platform/brand combo | `items: []`, `totalCount:0` | 400 if `pageSize>100` or `page<1` | Pagination is a post-cache in-memory slice — page 50 of an empty filtered set returns `items:[]` cleanly, not an error |
| `GET /v1/problems` | Cross-product theme clustering | query: `window`, `platform?`, `theme?` (must be a real `THEME_VOCABULARY` value) | `{window, cacheHit, filters, themes: ProblemThemeSummary[]}` | Category C, cached | `themes: []` | 400 invalid theme enum | **No `severityScore` or `totalScore` field exists anywhere in this response** — `severity.ts` has no approved formula; the UI must not imply a severity ranking that isn't there (e.g. no "sorted by severity") |
| `GET /v1/system/ingestion-status` | Pipeline freshness | none | `{watermarks: [...]}` (raw `ingestion_watermarks` rows) | spinner | n/a | 403 for non-admin | admin-only |
| `GET /v1/system/ai-usage` | AI run audit trail | none | `{runs: [...]}` (last 50 `ai_processing_runs` rows, raw) | spinner | `runs: []` if never run | 403 for non-admin | admin-only |

---

## 4. Analytics semantics — what the UI must represent honestly

Read directly from the analytics modules this step (not re-derived):

| Backend concept | Meaning | UI obligation |
|---|---|---|
| `confidence: "insufficient_data"` | Sample size below the floor (5 reviews) | Show explicitly ("not enough data yet"), never render the underlying number as if trustworthy, never hide the row |
| `confidence: "low"/"medium"/"high"` | `CONFIDENCE_THRESHOLDS`-gated sample-size tiers | A visible badge/indicator distinct from the raw number |
| `health.severityScore`, `health.totalScore` | **Always `null`** — no approved formula exists (Phase 4 §19, never resolved) | Must render as "not available" — never 0, never omitted silently as if it were just missing data |
| `signalType:"product_deterioration"`, `confidence:"not_ready"` | Permanently stubbed, by deliberate Phase 5 descope | Same treatment as above — a real, disclosed gap, not a bug to paper over |
| `signalType:"complaint_spike"` | Live signal (Phase 5 Step 2/4), fires on a real, dataset-tuned threshold | Render like any other live signal — it is NOT `not_ready` once a threshold is configured (current default: 200% growth) |
| `sudden_rating_decline` / `sudden_negative_review_increase` / `review_volume_spike` / `persistent_negative_trend` | All live, threshold-gated (`config.earlyWarning`, Step-4-tuned on the real dataset — not universally optimal, per the Phase 5 report) | Each carries `currentMetric`/`baselineMetric`/`delta`/`threshold`/`evidenceReviewIds` — the UI should show the actual numbers, not just a fired/not-fired badge |
| `themeConsistency[].classification === "marketplace_specific"` | In the **real dataset today**, this is dominated by a Myntra AI-classification coverage gap (36 theme mentions vs. Flipkart's 8,897 — Phase 5 report §5), not proven genuine marketplace behavior | If Phase 7 surfaces this real data, it must carry the same caveat the Phase 5 report does — not present as confirmed marketplace difference |
| `classification === "insufficient_evidence"` | Either platform's brand sample is below the floor | Distinct visual treatment from `marketplace_specific` — "not enough data to compare," not "different" |
| `available:false, reason:"no_mapping"` | No product-family mapping exists (table is empty everywhere today) | Must be presented as "not yet linked," and this is the state every real product will show — the product-comparison UI must be usable/honest with zero real examples to point at |
| `NarratorResult.rejectedCitations` / `irrelevantCitations` | IDs the AI cited that were invalid or off-topic, already stripped before this reaches the API (Phase 4.1 remediation) | Not typically shown to end users, but worth a debug/admin affordance since it's real, already-computed evidence of AI output being filtered |
| `NarratorResult.citedMetrics` vs `ungroundedMetrics` | `citedMetrics` = deterministically verified against real data; `ungroundedMetrics` = a number the model stated that did NOT verify | **This distinction is the single most important AI-trust signal Phase 4.1 built — Phase 7 must surface it, not silently merge both into "the AI said X"** |
| `droppedUnsupportedClaims` | Count of root-cause/recommendation entries removed for having zero grounded evidence after filtering | Worth a small "N unsupported claims were filtered" note for transparency, not hidden |

---

## 5. Frontend information architecture — proposed pages

| # | Page | Purpose | Primary question | Endpoints used |
|---|---|---|---|---|
| 1 | Executive Dashboard | Org-wide health snapshot | "How is the whole catalog doing, and what needs my attention right now?" | `/dashboard/executive`, `/early-warnings` (top alerts) |
| 2 | Product Rankings | Sortable/filterable catalog | "Which products are best/worst, by health or rating?" | `/products/rankings` |
| 3 | Early Warnings | Catalog-wide signal feed | "What's actively deteriorating?" | `/early-warnings` |
| 4 | Problems | Cross-product theme clustering | "What are customers complaining about, across the whole catalog?" | `/problems` |
| 5 | Product Detail | Single-product deep dive | "What's really going on with this one product?" | `/products/:platform/:id`, `/signals`, `/insights` |
| 6 | AI Insights (embedded in Product Detail, not a standalone list page — see §21) | AI narrative for one product | "Why, and what should I do?" | `/products/:platform/:id/insights` |
| 7 | Brand Marketplace Comparison | Flipkart vs Myntra, one brand | "Is this brand doing better on one platform?" | `/brands/:brand/compare` |
| 8 | Product Marketplace Comparison | Flipkart vs Myntra, one mapped product | "Is this specific product doing better on one platform?" | `/products/family/:id/compare` |
| 9 | System / Admin | Pipeline + AI cost visibility | "Is the data fresh, and what is this costing?" | `/system/ingestion-status`, `/system/ai-usage` (admin-gated) |

### Page-by-page design

**1. Executive Dashboard.** Components: KPI strip (`productCount`, `averageRatingScore`, `activeAlertCount`), Top Movers / Bottom Movers lists (from `topMovers`/`bottomMovers`, each already carrying a full `HealthScore`), a compact "recent warnings" panel pulling the highest-severity subset of `/early-warnings`. Filters: `window` only (the only query param this endpoint accepts — no platform/brand filter exists server-side, so none should appear in the UI here). Loading: skeleton KPI cards + skeleton lists (first real call ~2.3s at full catalog scale). Empty: `productCount:0` → explicit "no products ingested yet" state, not a blank dashboard. Error: standard error boundary. Insufficient-data: `averageRatingScore:null` renders as "—", not "0".

**2. Product Rankings.** A sortable/paginated table (`items`), toggle for `sort=health|rating`, filters for `platform`/`brand` (both server-supported), page controls bound to `page`/`pageSize` (max 100, enforced client-side too so an invalid request is never sent). Drill-down: row click → Product Detail. Loading: skeleton table rows. Empty: "no products match these filters." Insufficient-data: a row whose underlying `sortValue` is `null` should sort last, not crash the sort.

**3. Early Warnings.** A feed grouped by `signalType`, filterable by `platform`/`brand` (both server-supported) and `window`. Each signal card shows `currentMetric`/`baselineMetric`/`delta` against `threshold`, plus a link to the product. `not_ready` (`product_deterioration`) is shown in a visually distinct "not available" section, never mixed into the live feed. Loading/empty/error as above.

**4. Problems.** A theme-frequency table/bar chart (`mentionCount`, `distinctReviewCount`, `distinctProductCount`, `confidence`), filterable by `platform`/`theme` (both server-supported). **No severity column or sort** — the field doesn't exist. Drill-down: clicking a theme could filter Rankings or Early Warnings by implication (client-side navigation, not a new endpoint).

**5. Product Detail.** Header (platform/brand/id), tabs or stacked sections: Analytics (rating, trend, sentiment split from `analytics`), Health (the 5 `HealthScore` fields, with `severityScore`/`totalScore` explicitly shown as "not available"), Signals (`/signals`, same not_ready handling as page 3), AI Insights (`/insights`, see §14), and — only if a real family mapping exists for this product — Marketplace Comparison. Given `product_family_mapping` is empty everywhere today, this last section will realistically always show "not linked to a comparable product on the other marketplace" — a real, expected, honest state, not a bug.

**7. Brand Marketplace Comparison.** Side-by-side `BrandAnalytics` cards (Flipkart/Myntra), a rating-gap indicator (`ratingComparison`), and a theme-consistency table with three distinct visual states per theme (`marketplace_consistent`/`marketplace_specific`/`insufficient_evidence`) — carrying the real-data caveat from §4 if backed by the real dataset.

**8. Product Marketplace Comparison.** Only reachable from a Product Detail page that has a real family mapping; given today's empty table, this page's "no mapping" state is what most users will see, and that must be a first-class, well-designed empty state, not an afterthought.

**9. System/Admin.** Two simple tables (`watermarks`, `runs`), admin-only route guard client-side too (defense in depth — the real enforcement is server-side, §18).

---

## 6. Navigation (proposed, not final — see §21)

```
Overview        -> Executive Dashboard
Products        -> Rankings, Product Detail (via drill-down, not a nav item)
Warnings        -> Early Warnings
Problems         -> Problems
Marketplace      -> Brand Comparison (Product Comparison via drill-down only, since it needs a family id)
System            -> Admin status (only rendered/linked for role=admin)
```

Rationale: mirrors the API's own grouping (products/early-warnings/problems/brands+family/system) rather than inventing a different taxonomy — every top-level nav item maps to a real, working endpoint today, and nothing is added that has no backend behind it (e.g., no "AI Insights" top-level nav item, since insights are always scoped to one product, not a standalone list the API can serve).

---

## 7. Filtering strategy (server-verified, this step)

| Filter | Supported on | NOT supported on |
|---|---|---|
| `window` | All 9 non-system endpoints | — |
| `platform` | rankings, problems, early-warnings | product detail/signals/insights (platform is a path param there, not a filter), brand compare, family compare |
| `brand` | rankings, early-warnings | problems (no brand filter exists server-side today) |
| `theme` | problems | early-warnings, rankings |
| `sort` | rankings only (`health`\|`rating`) | everywhere else |
| `page`/`pageSize` | rankings only | every other list endpoint returns its full result unpaginated (`signals[]`, `themes[]`, `topMovers`/`bottomMovers` are pre-capped at 10 by the API itself) |

**No frontend filter should be built that isn't in this table**, per your explicit instruction — e.g., no client-side "filter problems by brand" unless explicitly scoped as future/out-of-scope UI that degrades gracefully (client-side filtering over an already-fetched small result set is acceptable **only if disclosed as client-side-only, not implied as a real query**).

---

## 8. Authentication strategy for this phase

Phase 6 has no login endpoint (deliberately — see the Phase 6 report). For local development, the frontend needs a token from `backend/scripts/issueDevToken.ts` (a CLI tool, not an HTTP endpoint). Proposed dev-only flow: a `.env.local`-style `VITE_DEV_TOKEN` (or framework-equivalent) injected at build/dev time, OR a tiny dev-only "paste a token" screen that stores it in memory/sessionStorage for the session. **Not proposing which** — flagged in §21. Either way:

- **401 handling**: redirect to a "session expired / no token" screen, never silently retry with no credentials.
- **403 handling**: role-aware UI must already have hidden the admin-only nav item, but the API call itself can still 403 (e.g. stale role in an old token) — must show a clear "not permitted" state, not a generic error.
- **Role-aware UI**: the JWT's `role` claim (decoded client-side for **display only** — never trust it for access control, since the real enforcement is server-side per `authorize()` — §18) drives whether the System nav item renders at all.
- **Explicitly distinguished from production**: this entire scheme is a development stand-in. A real login/identity-provider flow, secure token storage strategy, and refresh handling are all out of scope for Phase 7 and require a separate, explicit decision later (§21) — matching how `issueDevToken.ts` itself is documented as a deliberate, disclosed stand-in, not a production mechanism.

---

## 9. API client architecture (proposed)

- One centralized client module wrapping `fetch` (or the chosen query library's underlying transport), reading a single `API_BASE_URL` from environment config (never hardcoded).
- Every request attaches `Authorization: Bearer <token>` from one auth-state source — no component ever constructs this header itself.
- Typed responses: hand-written TypeScript types mirroring §3's table exactly (or generated from the Zod schemas if the frontend and backend end up sharing a package — a build/tooling decision, §21), so a backend response-shape change is a compile-time break, not a silent runtime one.
- Error normalization: every non-2xx response is parsed into one client-side error shape from the API's own `{error:{code,message}}` envelope — never a raw axios/fetch exception surfacing to a component.
- Request cancellation: appropriate for the query library's built-in support (e.g. React Query aborts stale requests automatically on param change) — not hand-rolled.
- **Frontend-level caching must not duplicate the backend's Category C cache** — the API already caches dashboard/rankings/early-warnings/problems for 60s server-side; a naive frontend cache with its own TTL could either (a) serve staler data than the user expects with no visibility, or (b) refetch needlessly inside the server's own cache window. Proposed: a short (e.g. 10-30s) client-side staleness window purely to dedupe rapid re-renders/refocus events, deferring to the server's cache for the real freshness guarantee — not re-implementing a second 60s cache client-side.

---

## 10. State/query management (recommendation, not a decision)

Given: server state dominates this app (every page is fundamentally "fetch and display API data"), there's real cache-key structure to respect (§9), and no complex client-only state exists (no multi-step forms, no offline mode). **Recommendation: a server-state library (e.g. TanStack Query) for all API data, plus local component state / light context for UI-only state (selected filters, active tab) — no global client-state store (Redux/Zustand) appears justified**, since there's no cross-cutting client state this app actually needs beyond "what did the last fetch return" and "what filters is the user looking at," both of which a query library or plain React state handle natively. **This is a recommendation for §21, not a decision.**

---

## 11. Visualization strategy

| Data | Visualization | Why |
|---|---|---|
| `productCount`, `averageRatingScore`, `activeAlertCount` | KPI cards | Single scalar, glanceable |
| `HealthScore`'s 5 components | Horizontal bar/gauge per component, with `null` fields rendered as "not available" segments, not zero-length bars | Comparable at a glance, honest about missing components |
| Rating trend (`recentMetrics` vs `historicalMetrics`, `ratingComparison`) | Simple before/after comparison card or small trend arrow, not a full time series (the API returns two periods, not a series) | Matches the actual data shape — no fabricated intermediate points |
| `ratingDistribution` (1-5 star counts) | Stacked/horizontal bar | Standard, matches discrete categorical data |
| `sentimentDistribution` | Donut/stacked bar (positive/neutral/negative) | Three-category proportion |
| `topThemes`/`topNegativeThemes`, Problems page | Horizontal bar table, sorted by count | Ranked categorical frequency |
| Rankings table | Data table with sort/pagination controls | Matches the API's own sort/paginate contract exactly |
| Early-warning signals | Cards/list with a severity-coded badge derived from `confidence` (not a fabricated severity score) | `EarlyWarningSignal` has no severity field either — badge must be confidence-based, not invented |
| Brand comparison | Side-by-side KPI cards + a comparison table for theme consistency | Two-entity comparison, matches `BrandMarketplaceComparison`'s actual shape |
| `themeConsistency` classification | Three-state badge (consistent/specific/insufficient), never a 2-state toggle | Matches the real 3-value enum |
| AI insight confidence per recommendation | Inline confidence value already in the payload (`recommendations[].confidence`, 0-1) | Already computed, don't re-derive |

**No sparklines** are proposed — the API never returns a time series (Phase 3 deliberately never built `trend_snapshots`; every trend is a two-period comparison, not a series), so a sparkline would have to fabricate intermediate points. Flagging explicitly per your instruction not to invent visualizations the backend can't back.

---

## 12. AI insight UX

Every AI-derived element must be visually distinct from deterministic analytics (e.g. a consistent "AI" badge/icon and a different card treatment) — never presented in the same visual register as a `HealthScore` number. Specifically:

- `insight.summary` — shown as narrative text, clearly AI-labeled.
- `insight.rootCause[]` / `insight.recommendations[]` — each entry shows its `evidenceReviewIds` as an expandable/linkable citation list (or a count + "view evidence" affordance), never presented as a bare claim.
- `insight.citedMetrics` — render inline as "grounded" (e.g. a small checkmark/verified indicator) since these are deterministically verified against real data.
- `insight.ungroundedMetrics` — **must be visually flagged as unverified**, not silently dropped — this is the single most load-bearing trust signal Phase 4.1 built into the system; hiding it would defeat its purpose.
- `insight.droppedUnsupportedClaims` — a small disclosure ("N additional findings were filtered for lacking evidence") if non-zero.
- Empty `rootCause`/`recommendations` arrays render as "no strong, evidence-backed finding for this period" — never blank space that could read as a loading/error state.
- **Recommendations are never phrased or styled as directives/guarantees** — `confidence` (0-1) is shown alongside every recommendation.

---

## 13. Design system (recommendation)

Given this is described as a "serious analytics/product-intelligence application," proposed direction (all subject to §21 approval, no implementation yet): a neutral, data-dense grid layout; a restrained accent palette reserved for status (confidence tiers, signal severity, consistent/specific/insufficient) so color carries meaning rather than decoration; a monospace or tabular-figure numeric style for aligned metric columns; consistent card/table primitives reused across all 9 pages rather than bespoke per-page styling. Typography: one display weight for page titles/KPIs, one body weight for everything else — no more than 2 type families. Specific token values (exact hex/spacing scale) are implementation detail, not an architecture decision — deferred to Step 1/implementation once a component library (§21) is chosen, since many component libraries bring their own token system.

---

## 14. Responsive strategy

Desktop-first (this is an analytics tool, primary use case is a wide monitor with dense tables/charts), but not desktop-only:

- **Desktop (≥1024px)**: full multi-column layouts, side-by-side comparison cards, wide data tables.
- **Tablet (768-1023px)**: KPI strips wrap to 2 columns, comparison cards stack vertically, tables gain horizontal scroll rather than column-hiding (so no data silently disappears).
- **Mobile (<768px)**: single-column, tables become either horizontally scrollable or condensed card-per-row, navigation collapses to a drawer/menu. Charts simplify (e.g. donut → stacked bar or a plain list) rather than rendering illegibly small.

---

## 15. Accessibility

Baseline requirements to design against (not implemented yet): semantic HTML/table markup for all data tables (not div-grids), sufficient color contrast especially for status/confidence badges (color must never be the *only* signal — pair with text/icon, since colorblind users must still distinguish `marketplace_consistent` from `marketplace_specific`), keyboard navigability for all interactive elements (filters, pagination, drill-downs), visible focus states, and ARIA live regions for async loading states so screen readers announce data arrival.

---

## 16. Testing strategy (to be written in a later step, not now)

- **API client**: unit tests mocking fetch/HTTP, covering the error-normalization path for every documented error shape (400/401/403/404/429/500/502/503).
- **Auth**: token-missing, token-expired, wrong-role scenarios, mirroring the backend's own `apiAuth.test.ts` coverage from the consumer side.
- **Role-based UI**: admin nav item hidden for non-admin, System page inaccessible.
- **Route rendering**: each of the 9 pages renders given a mocked successful response.
- **Loading/error/empty/insufficient-data/no-mapping states**: one test per state per page that has one (matching §3/§4's documented special states exactly — not a generic "shows a spinner" test).
- **Charts**: rendering given known input, not pixel-perfect snapshot testing.
- **Filters/pagination**: only the filters actually listed in §7 — a test asserting an unsupported filter is NOT sent would guard against scope creep.
- **AI insight rendering**: citedMetrics vs ungroundedMetrics visually distinguished (a real, specific assertion, not just "renders the AI card").
- **Accessibility**: automated axe-core-style checks on key pages, plus keyboard-navigation smoke tests.
- **Critical user flows**: login (dev-token) → dashboard → drill into a product → view AI insight; rankings → filter → paginate.

---

## 17. Performance strategy

Reusing Phase 6's real measurements (`docs/implementation/phase-6-api-implementation-report.md` §4, §6) rather than re-guessing: Category C endpoints can take **up to ~2.3s on a real cache miss at full catalog scale** (dashboard) and drop to **single-digit ms on a hit**. Frontend strategy:

- **Never recompute Category C aggregates client-side** — the dashboard/rankings/early-warnings/problems numbers are fetched as-is, never re-derived from raw data in the browser (there is no raw-data endpoint for the frontend to even do that with).
- **Initial dashboard load**: show skeleton state immediately, expect a multi-second first paint for the real aggregate numbers on a cold cache, and rely on the server's 60s cache for subsequent loads within that window — no client-side polling faster than that TTL would ever see fresher data.
- **Pagination**: always server-side for rankings (already paginated by the API) — never fetch all pages and paginate client-side.
- **Lazy loading**: route-level code splitting per page is reasonable given 9 distinct pages with little shared visualization code (a chart library alone can be sizable).
- **AI insight loads**: potentially the slowest single-product call (real provider latency, **NOT MEASURED** in this document — Phase 6 only measured deterministic endpoints and used the mock provider for validation) — must have its own, more patient loading state, decoupled from the rest of the Product Detail page (i.e., other sections should render before insights finish).

---

## 18. Security considerations

- **The frontend is never the security boundary** — every role check the UI performs (hiding the admin nav, disabling a control) is a UX convenience; the actual enforcement already happens server-side (`authorize()` middleware, Phase 6 §18) and must stay that way. A frontend bug that shows the wrong UI cannot itself leak data, because the API independently re-checks the role on every request.
- **Token storage**: dev-token approach (§8) should avoid `localStorage` for anything resembling a production pattern precedent — sessionStorage or in-memory is preferable even for this dev-only phase, so the eventual production implementation doesn't inherit a bad default by copy-paste.
- **XSS**: AI-generated text (`insight.summary`, `rootCause[].explanation`, etc.) is customer-review-derived, ultimately untrusted content flowing through a model — must be rendered as text, never `dangerouslySetInnerHTML`/`v-html`-equivalent, regardless of framework chosen.
- **JWT secret**: never touches the frontend at all — the frontend only ever holds a signed *token*, never `JWT_SECRET` itself; nothing in this design proposes shipping the secret client-side (confirmed there is no reason it ever would be).
- **Error handling**: the backend's `errorHandler.ts` already never leaks internal error messages (verified in Phase 6 Step 2 — a generic 500 strips the real message); the frontend must not defeat this by, e.g., logging full response bodies to a third-party service without review.
- **Sensitive data**: review text itself is customer-authored; the API already never returns raw review text on these 11 endpoints (checked — none of the response shapes in §3 include `review_text`/`title`/`author`, only aggregate numbers and `evidenceReviewIds`), so the frontend has nothing raw to accidentally over-expose today. If a future endpoint adds raw text, this section should be revisited.

---

## 19. Open decisions requiring your approval before implementation

None of the following are decided. No repo evidence points to any of them (§2) — each needs an explicit choice from you before Step 1 begins:

1. **Frontend framework** (React/Vue/Svelte/etc., and meta-framework or not — e.g. plain Vite+React vs. Next.js).
2. **Component library** (e.g. shadcn/ui, MUI, Ant Design, or none/hand-built).
3. **Chart library** (e.g. Recharts, Visx, Chart.js, D3 directly).
4. **State/query library** — recommended direction in §10 (a query library, no global store), but the specific library (TanStack Query vs. SWR vs. hand-rolled) is not decided.
5. **Authentication UX mechanics** for this phase — env-var dev token vs. a small "paste token" screen (§8).
6. **Hosting target** — still open since Phase 1 (never resolved in any prior phase); affects `API_BASE_URL` strategy, build output type (static vs. SSR).
7. **API base URL strategy** — single env var vs. environment-specific config files.
8. **Visual theme specifics** — exact palette/typography tokens (direction proposed in §13, values not chosen).
9. **Production identity provider** — explicitly out of scope for this phase (§8), but flagging that it remains a real, unresolved item for whenever "production" becomes real.
10. **Whether AI Insights gets any standalone surface beyond being embedded in Product Detail** (§5 note on page 6) — proposed as embedded-only since the API has no catalog-wide insights-list endpoint, but confirming this reading is correct before it shapes navigation.

---

## 20. Explicit out-of-scope items (this phase)

- The 3 deferred backend endpoints (`PATCH /v1/early-warnings/:id`, `POST .../insights/regenerate`, `POST /v1/analyst/query`) have no frontend surface — nothing in this design references them.
- Any production deployment, hosting setup, or CI/CD for the frontend.
- Any real login/identity-provider integration.
- Any backend, database, or API changes (none were made or proposed this step).
- Any change to `dashboard.ts`'s `averageRatingScore` placement or `model_version` exposure (both explicitly preserved per your standing instruction — the frontend design in §5/§11 consumes `averageRatingScore` and the `insight` shape exactly as they exist today, without asking the backend to change).

---

## 21. Step 0 verification results

| Check | Method | Result |
|---|---|---|
| `frontend/` contents | `ls -la` | **OBSERVED**: empty (0 files) |
| Root package manager/tooling | `find`/`ls` at repo root | **OBSERVED**: none exists |
| `.gitignore` frontend entries | `cat .gitignore` | **OBSERVED**: none |
| Backend API route set | Read `src/api/router.ts` directly | **PROVEN BY EXECUTION** (source read, matches the already-tested Phase 6 implementation) — exactly 11 GET routes, no others |
| Backend query/param schemas | Read `src/api/schemas.ts` directly | **PROVEN BY EXECUTION** (source read) — §3/§7 built directly from this file, not from memory of the report |
| Response shapes | Read all 8 controller files directly | **PROVEN BY EXECUTION** (source read this step) |
| Backend regression still green | `npm test` | **PROVEN BY EXECUTION**: 308/308 passing, re-run this step |
| No frontend files created | This session's own action log | **PROVEN BY EXECUTION**: only this one document was written |
| No backend/database/schema changes | This session's own action log | **PROVEN BY EXECUTION**: zero `Edit`/`Write`/migration/DB calls against backend or database this step |
| No AI calls | This session's own action log | **PROVEN BY EXECUTION**: zero — this step never invoked the app or any AI provider at all, purely static source inspection |
| No production access | This session's own action log | **PROVEN BY EXECUTION**: zero database connections opened this step |

---

**Stopping here. Not starting Phase 7 Step 1, not writing any frontend code, not installing any dependency — waiting for your explicit approval and decisions on §19 before implementation begins.**
