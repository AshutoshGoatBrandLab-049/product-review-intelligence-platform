# Phase 8 — Step 0 — UI/UX Transformation Audit & Plan

**This is a read-only document.** No frontend code, backend code, or database was modified. No dependencies were installed. No AI provider was called. Nothing was deployed.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Executive summary

Phase 7 delivered a functionally complete, honest, test-covered 9-page frontend. Phase 8 is not about new pages — it is about turning that functional frontend into a **Product Review Intelligence Command Center**: a product that makes attention, evidence, and decisions fast and trustworthy, not just a collection of correct tables.

The audit (four parallel deep-reads of the frontend, backend contracts, design system, and performance/data-trust posture, all **OBSERVED** this session, cross-checked against fresh source rather than trusting prior reports) surfaces a consistent picture:

- **The underlying data discipline is genuinely strong.** Nulls render as `—`, `insufficient_data`/`not_ready`/`no_mapping` are distinct, honestly-labeled, never-collapsed states; AI content is visually and structurally separated from deterministic data; badge components fail loud (a `TypeError`) rather than silently rendering a wrong-but-plausible status for an out-of-contract value. This is the right foundation for a "world-class... trustworthy" product and Phase 8 must preserve it exactly.
- **The single biggest constraint on "evidence-first" storytelling is the backend itself, not the frontend.** No endpoint anywhere in the 11-route surface returns review text, title, or author — evidence is, and can only ever be, an opaque `canonical_review_id` string. A "read the actual review that proves this" experience is **OPEN ENGINEERING DEPENDENCY — NOT CURRENTLY SUPPORTED**. This must shape every evidence-UI proposal in this plan.
- **The visual/interaction layer has real, fixable-in-frontend-only problems**: a single 865 KB JS bundle with zero route-level code-splitting; four independently-duplicated badge components sharing a de facto (but un-formalized) color vocabulary; two near-duplicate marketplace platform cards; a wired-but-never-toggled dark mode; fixed-pixel (non-responsive) charts; over half the pages with zero responsive classes; no reduced-motion handling; one real data-trust bug (`SentimentDistribution`'s partial-null handling, §8); and no drill-down at all from the Problems page (this one **is** a backend limitation, not fixable in Step 1+ without a schema/endpoint change).
- **A conversational "Ask AI" analyst is not supported by any existing endpoint** — no multi-turn, no streaming, no retrieval, no follow-up-question concept anywhere in `narrator.ts`/`types.ts`. Per your instruction, this plan documents it conceptually (§20) as **FUTURE / REQUIRES BACKEND SUPPORT** and proposes nothing to build now.

This document proposes a design direction, a component consolidation strategy, an investigation-workflow model, and a 13-step implementation order (§22) — all conditional on your approval. **Nothing has been built. This is Step 0 only.**

## 2. Current frontend architecture (OBSERVED)

React 19.2.8 / Vite 8.2.0 / TypeScript ~6.0.2 / TanStack Query 5.101.4 / React Router 7.18.2 / Tailwind v4.3.3 + shadcn/ui / Recharts 3.10.1. Single `QueryClient` (global `retry: false`, `refetchOnWindowFocus: false`, no global `staleTime`); the four Category C hooks (`useEarlyWarnings`, `useExecutiveDashboard`, `useProductRankings`, `useProblems`) add a 15s `staleTime` + `keepPreviousData`; every window-driven marketplace/product-detail hook also uses `keepPreviousData`. Auth is a single in-memory dev token (`VITE_DEV_TOKEN`), decoded client-side for role display only — no login flow exists. All 9 pages plus 2 auxiliary screens (`NotPermitted`, `DevAuthRequired`) are statically imported into one route tree under a single `AppShell` (fixed desktop sidebar / `Sheet` overlay below 768px, built entirely on shadcn's own sidebar primitive — this part is already genuinely responsive). No environment-tier split beyond `NODE_ENV`; `VITE_API_BASE_URL` and `VITE_DEV_TOKEN` are the only two frontend env vars.

## 3. Current page inventory (OBSERVED)

| # | Page | Route | Endpoint(s) | Layout (top→bottom) | Drill-down |
|---|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | `dashboard/executive`, `early-warnings` | header+window → 3-col KPI grid → 2-col Top/Bottom Movers → Active Warnings → not-ready group | Movers/warnings → Product Detail |
| 2 | Product Rankings | `/products` | `products/rankings` | header+window → sort/platform/brand filters → table → pagination | Row → Product Detail |
| 3 | Product Detail | `/products/:platform/:id` | detail, `/signals`, `/insights` (on-click only) | header → 4-col KPI → health-component card → 2-col rating/sentiment → signals → evidence → AI insight (gated) | Signals → self (inert); AI insight embeds evidence |
| 4 | Early Warnings | `/warnings` | `early-warnings` | header+window → platform/brand filters → signal-type tabs (client-derived) → card grid → not-ready group | Cards → Product Detail |
| 5 | Problems | `/problems` | `problems` | header+window → platform/theme filters → table | **None — no product identifiers in the response at all** |
| 6 | Brand Comparison | `/marketplace/brands/:brand` | `brands/:brand/compare` | back-link → rating-gap card (conditional) → 2-col platform cards → theme-consistency table | None forward |
| 7 | Product Comparison | `/marketplace/products/:familyId` | `products/family/:id/compare` | back-link → `NoMappingState` (today, always) OR rating-gap + 2-col cards | Cards → Product Detail (only if `available:true`, never in real data today) |
| 8 | System/Admin | `/system` (admin-only) | `system/ingestion-status`, `system/ai-usage` | header (no filters) → ingestion table → AI-usage table | None |
| 9 | BrandsIndex | `/marketplace/brands` | none | **still a Step-1 `StubPage`** — no brand search/selection UI | N/A |

Full component-level detail (every field displayed, every state's exact rendering, every explicit "not shown because contract doesn't support it" comment) is preserved in the audit transcript and summarized in §4/§6/§8 below; it is not repeated in full here to keep this document navigable.

**Component inventory finding**: `RatingDisplay.tsx`, `SystemStatusBadge.tsx`, `ThemeList.tsx`, and `NotReadyState.tsx` are built but used by **zero** of the 9 pages — dead code. `BrandPlatformCard` and `ProductComparisonCard` are near-duplicate implementations of the same "one platform's analytics card" concept. `EarlyWarningCard` and `MoverCard` share a visual pattern (linked card + metric `dl` grid) but differ in field set, unconsolidated. Three pages (Dashboard, Warnings, Product Detail) each hand-roll their own "Not Available Yet" grouped-signal box inline instead of using the existing (unused) `NotReadyState` component.

## 4. Current API/UI contract inventory (OBSERVED, re-verified from source, not prior reports)

All 11 routes are `GET`-only (router comment: *"Phase 6 v1 is READ-ONLY... no PATCH/POST routes exist anywhere in this router"*). 9 are `anyRole`; `system/ingestion-status` and `system/ai-usage` are `adminOnly`.

| Endpoint | Cache | AI? | Notable fixed/null semantics |
|---|---|---|---|
| `products/:platform/:id` | No | No | `severityScore`/`totalScore` **always** `null` (no approved formula) |
| `.../signals` | No | No | `complaint_spike` and `product_deterioration` unconditionally/conditionally `not_ready` |
| `.../insights` | DB-persisted content-hash cache | **Yes — only AI-triggering route** | — |
| `brands/:brand/compare` | No | No | per-platform frequency % null when that platform has 0 reviews |
| `products/family/:id/compare` | No | No | discriminated union; `no_mapping` is a real 200, never a 404 |
| `early-warnings` | Category C, 60s | No | same not_ready semantics as signals |
| `dashboard/executive` | Category C, 60s | No | movers sorted by `trendScore`, never by the always-null `totalScore` |
| `products/rankings` | Category C, 60s | No | `brand` filter is **exact match only**, no partial/fuzzy search anywhere in the call chain |
| `problems` | Category C, 60s | No | **no `severity` field emitted at all**; response carries no product/evidence identifiers |
| `system/ingestion-status` | No | No | raw table passthrough |
| `system/ai-usage` | No | No | raw table passthrough, capped at 50 rows |

**Cross-cutting facts that must govern every design decision in §16–§20:**
- **`insufficient_data`**: sample size 0–4 reviews only (`confidence.ts` thresholds: high ≥100, medium ≥20, low ≥5, else insufficient_data).
- **`not_ready`**: exactly two signal types, both because no approved formula/threshold exists — never a transient "still computing" state.
- **`no_mapping`**: exact-lookup only; *"nothing here ever infers or fuzzy-matches a Flipkart pid to a Myntra product_id."*
- **Evidence is IDs only, forever, by design**: `canonicalReviewIds: string[]`, capped at 20. No endpoint selects `review_text`/`title`/`author` for client return, anywhere.
- **AI insight (`NarratorResult`)**: one-shot, cacheable-by-content-hash. No streaming type exists. No confidence field on `rootCause` entries (only `recommendations[].confidence`). `citedMetrics` verification is narrow — *"a number written ONLY in free-form prose is NOT parsed out of that text and is NOT verified."*
- **No time-series anywhere.** Every analytics function returns one window snapshot + one prior-period comparison via `comparePeriods`. `product_daily_metrics` has daily grain underneath, but every consumer `sum()`s it into one aggregate before it ever reaches a response type. **A trend-line chart of any kind would be fabricated data** unless built directly from a new/changed backend capability.
- **No server-side search.** Brand/theme filters are exact-string equality throughout (`catalogSweep.ts`, `brandAnalytics.ts`, `problemsAggregate.ts`). No `ILIKE`/full-text/trigram usage anywhere in the 11-endpoint call chain.
- **No write operations of any kind** — no acknowledge/dismiss, no regenerate, no notifications/webhooks/subscriptions (repo-wide search: zero matches).

## 5. Current design-system audit (OBSERVED)

**Color**: a genuine, coherent oklch-258 (blue-indigo) accent system exists for `primary`/`accent`/`ring`/`sidebar-*` in both a light and a complete `.dark` block. **Dark mode is fully defined but entirely dead — nothing in the codebase ever toggles the `.dark` class**, no theme provider, no OS-preference detection, no persisted choice. `--destructive` is a separate warm red/orange hue (27.325°), and the 5 chart tokens deliberately sweep 5 different hues (blue/teal/amber/red/purple) for future categorical charting — none of that palette is used by any chart today (only 2 charts exist, neither multi-series). Radius scale is a clean single-base `calc()` derivation.

**Status badges**: 4 independent components (`ConfidenceBadge`, `SignalBadge`, `MarketplaceBadge`, `SystemStatusBadge`), each re-declaring its own literal Tailwind classes rather than sharing a token map. A real, consistent 3-tone vocabulary already exists by convention (not by shared code): emerald-50/700/200 = good, amber-50/700/200 = caution, slate-100/600/200 = unknown/insufficient. Two outliers break this: `SignalBadge` uses **orange** (a fourth hue family) for its single "fired" state, and `SystemStatusBadge` (unused by any page) has a **red** "error" tone none of the other three ever needs. None of the four badges consume the `--destructive`/`--primary` design tokens at all — they're fully decoupled hardcoded literals.

**Typography**: single typeface (Geist Variable, true variable font, efficient loading — 5 subset files, ~76 KB total). Heavily dominated by `text-xs`/`text-sm` (151 of ~190 sizing occurrences) — a dense, compact, data-forward visual language, not a spacious editorial one. Heading depth never exceeds `h1`→`h2` (zero `h3`/`h4` anywhere), even where visual sub-grouping exists (e.g., `dl` stat blocks have no heading at all). `tabular-nums` is applied consistently to essentially every rendered numeric value — a real strength for a numbers-heavy product.

**Spacing**: `space-y-6` at page root, `space-y-3` at section level, `gap-4` in card/KPI grids, `gap-1`/`gap-2` in compact inline groups — consistent by repetition, not by shared constants.

**shadcn primitives present**: Alert, Badge, Button, Card, Dialog, DropdownMenu, Input, Separator, Sheet, Sidebar, Skeleton, Table, Tabs, Tooltip. **Explicitly absent**: Select, Popover, Command/Combobox, a dedicated Drawer (Sheet fills that role today). This directly constrains what search/filter/evidence-drawer UI can be built without a new dependency install (which Phase 8 may do — it's a frontend-only change — but it is not free).

## 6. UX audit

Applying the required 9 questions per major screen (OBSERVED judgments grounded in §3/§4, not measured with real users — **NOT MEASURED**: no usability testing has ever been performed on this product):

| Page | 5-sec understand? | Important info dominant? | Attention identifiable? | "Why" reachable? | Evidence reachable? | Can continue investigation? | Next action obvious? | Missing states understandable? | Cognitive load |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard | Yes — KPI strip + movers is immediately legible | Yes | Yes (Active Warnings section) | Partial — health-score components shown, but "why" requires going to Product Detail | Only via drill-down | Yes | Yes (drill-down obvious) | Yes (explicit empty/not-ready copy) | Low |
| Rankings | Yes | Yes (sortable table) | Only via sort, no visual flag | No | No | Yes (row → detail) | Yes | Yes | Low-medium (dense table) |
| Product Detail | Yes, but long — 6 stacked sections with no in-page nav/anchor jump | Rating/health KPIs dominant | Yes (signals section) | Best page for this — health components + signals + AI insight together | Yes (evidence section + AI citations) | Partial — no path back out to related products/brand | Yes for AI ("Generate" button); otherwise passive scrolling | Yes | Medium — 6 full sections, no collapsing/tabs |
| Warnings | Yes | Yes | Yes (this IS the attention page) | Partial (delta/threshold shown, no root-cause) | Only via drill-down | Yes | Yes | Yes | Low-medium |
| Problems | Yes for the table itself | Yes (mentionCount-sorted) | No — nothing marks a theme as "needs attention" vs. background noise | No | **No — no evidence identifiers in the response at all** | **No — genuine dead end, no product identifiers returned** | Unclear — page has no forward action | Yes | Low, but the dead-end itself IS the biggest UX problem on this page |
| Brand Comparison | Yes | Yes (rating gap headline) | Only via the (currently `slate`/`amber`) theme-consistency badges | Partial (theme frequencies shown, no root-cause) | No (no per-review evidence at brand level — never has been) | No forward link | Yes for filters, no clear "so what" | Yes | Medium |
| Product Comparison | Yes, but nearly always shows only `NoMappingState` in real data | N/A today | N/A today | N/A | N/A | N/A | Unclear what a user should do when they land here and see "not linked" | Yes | Low (because it's almost always empty) |
| System/Admin | Yes | Yes (two clear tables) | Yes (status badges per row) | N/A (ops page, not a "why" page) | N/A | N/A | N/A | Yes | Low |
| BrandsIndex | **No — it's a stub with no interactive content at all** | N/A | N/A | N/A | N/A | N/A | **No — there is no way to reach a specific brand from here** | N/A | N/A (broken entry point) |

## 7. Information architecture audit

Current top-level nav (Overview/Products/Warnings/Problems/Marketplace/System) mirrors **the API's own grouping**, per an explicit Step-1 design decision, not the "WHAT → WHY → EVIDENCE → NEXT" journey the master brief specifies. In practice, the journey is only fully realized for the **single-product path**: Dashboard/Rankings/Warnings (WHAT) → Product Detail's health/signals (WHY, partially — no root-cause without the AI insight) → evidence chips + AI insight (EVIDENCE + interpretation) → AI recommendations (NEXT). That path is genuinely good today.

Two structural IA gaps, one fixable in frontend, one not:
1. **Problems is a true dead end** (no product/evidence identifiers in its response) — **cannot be fixed without a backend/schema change**. This is the single largest information-architecture hole in the product relative to the stated journey model.
2. **BrandsIndex is a broken entry point** — the "Marketplace" nav item leads to a page with no way to reach any of the pages it nominally introduces. This **can** be improved in frontend alone up to a real limit: there is no backend endpoint that lists distinct brand names, so a true type-ahead brand search cannot be built without one (see §21). A frontend-only mitigation (recent/known brands via client-side history, or requiring the user to already know a brand's exact name) is possible but is a stopgap, not a real search experience.

## 8. Data-trust audit

The overall discipline is strong and must be preserved (§1). One real, concrete defect was found:

**`SentimentDistribution.tsx:28-30`** coalesces each of `positivePercentage`/`negativePercentage`/`neutralPercentage` independently with `?? 0` before charting. The component only substitutes `InsufficientDataState` when **all three** are null simultaneously (`SentimentDistribution.tsx:23-25`). If only one or two of the three are genuinely null (a plausible partial-coverage state — e.g., neutral classification incomplete while positive/negative are populated), the chart silently renders a real `0%` slice indistinguishable from an honest zero, and the three displayed percentages would no longer sum to 100 with no visual indication anything is missing. This is used in three places (`BrandPlatformCard`, `ProductDetail`, `ProductComparisonCard`) and should be fixed in whichever Phase 8 step touches those pages (§22) — not fixed in this read-only step.

No other nullable score field (`averageRating`, `severityScore`, `totalScore`, `sentimentScore`, `complaintScore`, `flipkartFrequencyPercent`, `myntraFrequencyPercent`, `percentageDelta`) is ever coalesced to a numeric default anywhere in the codebase — every other instance uses an honest string fallback (`"—"`, `"Not available yet"`).

`insufficient_data`/`not_ready`/`no_mapping` each have a dedicated component with an explicit anti-fabrication comment, and are never merged with each other. AI content is visually and structurally distinct from deterministic data (`AIInsightCard`'s violet AI-summary panel, separate green "Grounded metrics" / amber "Unverified metrics" panels, a surfaced `droppedUnsupportedClaims` count) — this is exactly the CLAIM→WHY→EVIDENCE pattern the brief asks for, already partially built, and should be the template extended elsewhere rather than reinvented. All four status-badge `CONFIG` lookups are exhaustive `Record` types with no `default:` case — an out-of-contract value would crash the component (fail-loud) rather than render a misleading-but-plausible badge (fail-silent). This is an acceptable trade today given TypeScript's compile-time exhaustiveness guarantee, but is worth a defensive runtime fallback if Phase 8 wants zero-crash resilience (a design decision, not a data-trust defect).

## 9. Accessibility audit

Genuine strengths: color is never the only status signal (icon + text + color on every badge, by explicit design-doc rule referenced in code comments); ARIA is used correctly where present (`aria-labelledby` sections, `aria-live="polite"`/`aria-busy` on loading states, `aria-label` on every ambiguous `TabsList`); tables use fully semantic `<table>/<thead>/<tbody>/<th>/<td>` markup; no bare `<div onClick>` without a role/keyboard handler was found anywhere; focus-visible styling is present on every interactive primitive actually used (Button/Tabs/Badge/Input), so coverage is consistent by inheritance.

Concrete gaps found:
- **Reduced motion is entirely unhandled** — zero matches for `prefers-reduced-motion`/`motion-reduce` anywhere in the codebase.
- **Heading depth never exceeds two levels.** Dense `dl` stat blocks and card sub-groupings have no heading at all, which is acceptable for small blocks but becomes a real screen-reader navigation gap on long pages (Product Detail's 6 stacked sections).
- **Warnings page has no `aria-labelledby`-wrapped `<section>`/`<h2>` structure at all**, unlike every other page — its filter/card content isn't landmarked.
- **`<th>` elements have no `scope="col"`**, and no table exposes `aria-sort` on sortable columns (Rankings) — screen-reader users get no relationship cue between a header cell and its column's data.
- **`AppHeader.tsx`'s conditional `<h1>`** (gated by a `title` prop no page ever passes) is dead code, not a live conflict, but worth removing during any header rework.

## 10. Responsive audit

Genuine strength: the **application shell** (sidebar) is properly responsive — a real 768px breakpoint switches between a fixed desktop sidebar and a `Sheet` mobile overlay, built on shadcn's own primitive, with `sr-only` labeling for accessibility.

Everything below the shell is inconsistently responsive:
- **Over half the pages** (`Problems`, `Products`, `System`, plus the stub/auth screens) **have zero responsive Tailwind classes at all** — desktop-only layout today.
- **Every data table** relies solely on the shared `overflow-x-auto` wrapper plus `whitespace-nowrap` — meaning every table (Rankings, Problems, AI Usage, Ingestion, Theme Consistency) requires horizontal scrolling on mobile with no column-reflow/stacking alternative.
- **Both charts use fixed pixel dimensions** (`BarChart width={320} height={180}`, `PieChart width={120} height={120}`) with no `ResponsiveContainer` — they will not resize with viewport and can overflow/clip on narrow screens.
- **Roughly half of all `grid-cols-*` usages are fixed-column with no responsive variant** — specifically, every small inline `dl` stat block inside a card (EarlyWarningCard, MoverCard, BrandPlatformCard, ProductComparisonCard) is a fixed 2–4 column grid regardless of viewport, while page-level layout grids (KPI strips, two-column card layouts) generally do have responsive variants.

## 11. Performance baseline

**PROVEN BY EXECUTION** (ran this session): `npm run build` succeeds in 549ms, zero TypeScript errors, and produces a **single 865.34 KB JS chunk (258.93 KB gzip)** plus a 79.33 KB CSS file — Vite's own >500KB chunk-size warning fires. This is directly explained by **OBSERVED** fact: `router.tsx` statically imports all 9 pages; zero `React.lazy()`/dynamic `import()` usage anywhere in the route tree. This is the single highest-leverage, lowest-risk performance fix available — pure frontend, no backend dependency, and route-level code-splitting is a well-understood, low-risk Vite/React pattern.

Other **OBSERVED** findings: no heavy/duplicated dependencies (one chart library, no date library, tree-shakeable icon imports); the variable-font loading strategy is already efficient; TanStack Query is correctly configured with no duplicate/overlapping requests found on any page; memoization (`useMemo`/`useCallback`) is used sparingly (3 app files) but no genuinely expensive unmemoized computation was found in the three audited table components (they contain a bare `.map()` over already-paginated data, not an inline sort/filter chain) — so the memoization gap is not currently proven to cause a real problem, though a `React.memo` on table row components would reduce unnecessary re-renders on unrelated filter-state changes.

**Backend Category C cache**: **OBSERVED-from-comment**, not re-run this session (the benchmark script explicitly refuses to run against the isolated test fixture and this was a frontend-scoped read-only audit) — a code comment in `ttlCache.ts` cites prior real numbers: `computeHealthScore` full-catalog sweep 1,100.9ms, `computeProductAnalytics` 451.4ms, `detectAllProductSignals` 1,730.6ms, `computeProblemsAggregate` 197.0ms, at 1,004 products. These numbers are **not** re-verified this session and should be labeled as such in any future report that cites them.

**NOT MEASURED this session**: real browser paint/interaction timing (no Lighthouse/WebPageTest run), any load test at scale, real user perceived-performance data.

## 12. Current vs. Future capability matrix

🟢 CURRENT — supported today · 🟡 CURRENT BUT LIMITED · 🔵 FUTURE — requires backend/API change · 🔴 NOT SUPPORTED — do not represent as available

| Capability | Status | Grounding |
|---|---|---|
| Product health (rating/trend/sentiment/complaint scores) | 🟢 | `products/:platform/:id` |
| Ratings (current + prior-period comparison) | 🟢 | Every analytics endpoint |
| Sentiment split (pos/neg/neutral %) | 🟢 | `CoreMetrics` |
| Themes (cross-product frequency) | 🟢 | `problems` |
| Themes (per-product) | 🔴 | No deterministic per-product theme endpoint exists — only surfaces inside AI `rootCause`, which is AI-labeled, not deterministic |
| Early warnings (5 of 6 signal types) | 🟢 | `early-warnings`/`.../signals` |
| Early warnings — `product_deterioration`, `complaint_spike` (no configured threshold) | 🔴 | Both permanently `not_ready` — no approved formula/threshold |
| Evidence (review-ID citations) | 🟡 | IDs only, capped at 20, **never review text/title/author — structurally absent from every endpoint** |
| Marketplace comparison (brand-level) | 🟢 | `brands/:brand/compare` |
| Marketplace comparison (product-level) | 🟡 | Endpoint and UI both work correctly; `product_family_mapping` is 0 rows in real data, so `no_mapping` is what every real product shows today |
| Product-family mapping population | 🔴 | No populate path anywhere in the codebase, by deliberate design (business decision, not engineering) |
| Freshness (ingestion watermarks) | 🟢 | `system/ingestion-status` (admin-only) |
| Time-series / trend charts (multiple dated points) | 🔴 | No endpoint returns more than one window snapshot + one prior-period comparison, anywhere |
| Severity | 🔴 | `severityScore`/`totalScore` always `null`; no approved formula exists (Phase 4/5 descope) |
| Risk score | 🔴 | Does not exist in any form |
| AI insights (single-shot narrative per product) | 🟢 | `.../insights`, user-triggered only |
| Conversational AI / multi-turn | 🔴 | No session/message-history concept anywhere in `narrator.ts`/`types.ts` |
| AI streaming | 🔴 | `narrate()` returns one awaited JSON object; no streaming type exists |
| AI citations (ID-level) | 🟢 | `rootCause[].evidenceReviewIds`, `recommendations[].evidenceReviewIds` |
| AI citations (numeric-claim verification) | 🟡 | Only for numbers the model places in the structured `citedMetrics` channel — prose-only numbers are never verified |
| Evidence retrieval (search within reviews) | 🔴 | No full-text/fuzzy search exists anywhere in the backend |
| Recommendations (AI-generated) | 🟢 | `insight.recommendations[]`, with confidence 0–1 |
| Recommendation approval/acknowledgement | 🔴 | No write endpoint exists anywhere in the API |
| Warning/problem acknowledgement or dismissal | 🔴 | Same — zero write endpoints in the whole API |
| Investigation sharing (e.g., shareable deep-link state) | 🟡 | URL-synced filters already exist per-page (frontend-only, works today); no server-side "saved investigation" concept |
| Advanced/fuzzy search (brands, products, themes) | 🔴 | Every filter is exact-string equality; no distinct-value-listing endpoint exists (e.g., no "list all brand names") |
| Notifications | 🔴 | Zero matches for webhook/subscribe/notification anywhere in the backend |
| Authentication / RBAC | 🟡 | Real server-side RBAC (`adminOnly`/`anyRole`) is solid; but auth itself is dev-token-only, CLI-issued, no login flow, not production-viable |

## 13. Highest-impact UX problems

1. **Problems is a dead end** — no path from a recurring theme to the products/reviews behind it. Backend-limited (§4/§7); cannot be fixed without a schema/endpoint change.
2. **BrandsIndex is a broken entry point** — the Marketplace nav item leads nowhere actionable. Partially backend-limited (no brand-listing endpoint for real search) but a meaningful frontend-only interim exists (§21).
3. **No unified "what needs my attention right now" view spanning warnings + problems + comparisons** — a user must visit 3+ separate pages to assemble the full WHAT picture; Dashboard's "Active Warnings" panel is the closest thing but only surfaces early-warning signals, not problems or marketplace gaps.
4. **Product Detail is a long, un-navigable single scroll** — 6 stacked sections with no in-page anchor nav or tabs, on a page whose whole purpose is deep investigation.
5. **No visual distinction of "worth investigating" vs. "background noise"** on Rankings/Problems — everything in a table row reads with equal visual weight regardless of how far a value is from normal (though no severity score exists to rank by, the already-real `delta`/`trendScore`/`mentionCount` magnitudes could drive presentational emphasis without fabricating anything new).

## 14. Highest-impact visual problems

1. **Four duplicated badge components** with an unformalized (but real) 3-tone semantic vocabulary, plus two outlier hues (orange in SignalBadge, red in unused SystemStatusBadge) that don't fit the rest of the system.
2. **Dark mode fully built, never wired up** — a complete, unused design-system asset.
3. **Two near-duplicate marketplace platform cards** (`BrandPlatformCard`, `ProductComparisonCard`) that should be one component.
4. **Heading depth capped at two levels everywhere**, flattening visual hierarchy on long pages and dense stat blocks.
5. **Fixed-pixel, non-responsive charts** that will visibly break or clip on narrower viewports.

## 15. Highest-impact performance UX problems

1. **Single 865 KB JS bundle, zero code-splitting** — every user downloads all 9 pages' code on first load regardless of which one they need. This is the single highest-leverage fix in the whole audit: pure frontend, no backend dependency, low implementation risk.
2. **No `ResponsiveContainer` on charts** — a perceived-quality problem more than a raw performance one, but it's a real broken-on-resize bug today.
3. **No loading-state choreography beyond per-section skeletons** — acceptable today, but as pages grow richer (per §16–§19) naive addition of more independent queries without a coordinated loading strategy could regress perceived performance; flagged now so later steps design for it deliberately.

## 16. Proposed world-class information architecture

Reframe navigation around the journey, not the API's route grouping, without removing any existing real capability:

- **Command Center (Dashboard)** — WHAT. Becomes the single "what needs attention across the whole catalog" surface: keep KPI strip + movers, but add a real (not fabricated) unified attention feed that interleaves early-warning signals by real delta magnitude — no new formula, purely a presentational sort of already-returned numbers, consistent with how Warnings' signal-type filter was already established as legitimate client-side *grouping* rather than *analytics*.
- **Catalog (Rankings)** — WHAT, catalog-wide. Unchanged data contract; visual redesign only (§17–§18).
- **Product Intelligence (Product Detail)** — WHY + EVIDENCE + NEXT, for one product. Restructure the 6 stacked sections into an anchored/tabbed layout (Overview / Signals / Evidence / AI) so a user can jump directly to "why," matching the journey model far more literally than a single long scroll.
- **Warnings & Problems** — WHAT is happening, grouped by kind. Keep as separate pages (their data contracts are genuinely different — Warnings has product identifiers and evidence, Problems structurally does not) but visually unify their card/table language so they read as one family, not two unrelated tools. Problems' dead-end (§13.1) should be explicitly and honestly presented as a catalog-wide *signal*, with copy that tells the user which page (Rankings, filtered by theme where the contract allows — theme is not a Rankings filter today, so this may itself need a small future backend addition, flagged in §21) can help them find affected products, rather than silently offering no next step.
- **Marketplace** — WHY (platform-specific). Fix the BrandsIndex dead-end (§21) as the top priority here; the two comparison pages' internal layout can adopt the same consolidated platform-card component (§18).
- **System/Admin** — unchanged in spirit (an ops page, not part of the investigation journey); visual consistency pass only.

## 17. Proposed design-system direction

- **Wire up dark mode.** The tokens already exist and are already well-designed (§5); adding a theme provider + toggle is a contained, low-risk, high-perceived-quality win with zero backend dependency.
- **Formalize the 3-tone semantic vocabulary** (`success`/`caution`/`neutral`) that already exists by convention into real design tokens (extending `index.css`'s `@theme inline` block), and fold in `--destructive` as the 4th (`danger`) tone for genuinely severe states — resolving SignalBadge's orange outlier and SystemStatusBadge's unused red outlier into one coherent, intentional system rather than 4 independent literal palettes.
- **Introduce a third heading level (`h3`)** for stat-block/card sub-grouping, improving both visual hierarchy and screen-reader navigation on long pages (directly addresses §9's heading-depth gap).
- **Keep the dense, `text-xs`/`text-sm`-dominant, `tabular-nums`-everywhere typographic voice** — this is a genuine strength for a numbers-heavy business tool and should not be replaced with a more spacious "editorial" feel; a command center should feel precise and information-dense, not decorative.

## 18. Proposed component strategy

- **Consolidate the 4 badge components into one `StatusBadge` primitive** parameterized by `{tone: success|caution|neutral|danger, icon, label}`, with each existing domain component (`ConfidenceBadge`, `SignalBadge`, `MarketplaceBadge`) becoming a thin mapping layer on top rather than a fully independent implementation. Retire `SystemStatusBadge` (already dead) in favor of this, or repurpose it as the primitive itself.
- **Merge `BrandPlatformCard` and `ProductComparisonCard`** into one `MarketplacePlatformCard` taking either `BrandAnalytics` or `ProductAnalytics`-shaped props (they already share the same `CoreMetrics` core).
- **Factor the three inline "Not Available Yet" grouped-signal blocks** (Dashboard, Warnings, Product Detail) into the existing, currently-unused `NotReadyState` component (or a small evolution of it) instead of three copies of the same JSX.
- **Adopt shadcn's Select and Popover primitives** (net-new install, frontend-only) for any structured filter UI beyond the current Tabs-based filters, and for the BrandsIndex interim search (§21) — Command/Combobox only if/when a real distinct-value-listing endpoint exists to back it (§21); building a fuzzy-search-feeling UI on top of an exact-match-only backend would be misleading UX, not a genuine improvement.
- **Fix the `SentimentDistribution` partial-null defect** (§8) as part of whichever step touches that component.
- **Wrap both charts in `ResponsiveContainer`**, and extend real responsive classes to the 4+ desktop-only pages (§10).

## 19. Proposed investigation workflow

For the one path the backend genuinely supports end-to-end (a single product): **Signal → Product → Evidence → Explanation → Decision**, already mostly present in Product Detail, made explicit via the anchored/tabbed restructure in §16 — a user arriving from a Dashboard/Warnings/Rankings card should land on Product Detail with the "Signals" tab pre-focused (not the top of a long scroll), one click from "Evidence," one click from "AI Insight." For the catalog-wide path (Problems, Brand Comparison), the workflow honestly ends at "here is the pattern" without a forced-fake "click here to see the specific products" — because that specific-product link does not exist in the data today (§4/§13.1). The evidence step itself must always be framed as **"N reviews support this"** (a citation count and, if useful, a way to view the opaque ID list — e.g., in an Evidence `Sheet`/drawer using the already-installed Sheet primitive) rather than **"read what customers said"**, because the latter cannot be honestly delivered by any current endpoint.

## 20. Future AI UX direction (conceptual only — NOT implemented, NOT specced against a real API)

Per your instruction, this is documented as **FUTURE / REQUIRES BACKEND SUPPORT** and nothing here is a commitment or a spec:

- **Global "Ask AI"**: would require a new endpoint accepting an open question and returning a grounded answer — does not exist. **OPEN ENGINEERING DEPENDENCY.**
- **Product-context / warning-context / evidence-context AI**: the *product-context* single-shot version already exists (`.../insights`) and is the right foundation; warning-context and evidence-context variants would each need either a new endpoint or a materially extended evidence-package input to the existing narrator — **OPEN ENGINEERING DEPENDENCY** for anything beyond what `.../insights` already returns.
- **Conversation / multi-turn / follow-up questions**: no session/message-history concept exists anywhere in `ai/`. **OPEN ENGINEERING DEPENDENCY.**
- **Streaming**: `narrate()` is a single awaited call with no chunked response type. **OPEN ENGINEERING DEPENDENCY.**
- **Retrieval (searching within reviews for an answer)**: no full-text/semantic search exists anywhere in the backend. **OPEN ENGINEERING DEPENDENCY.**
- **Evidence drawer**: buildable today, but strictly limited to ID/citation-count display (§19) — cannot show review content. **CURRENT BUT LIMITED**, not an open dependency, just a hard ceiling.
- **Confidence per claim**: exists today only on `recommendations[]` (0–1), not on `rootCause[]`. Extending confidence to root-cause claims would need a narrator/schema change. **OPEN ENGINEERING DEPENDENCY.**
- **Unsupported-question handling / insufficient-evidence-for-a-question**: cannot be designed against a real contract because no question-answering endpoint exists yet. **OPEN ENGINEERING DEPENDENCY.**
- **Recommendation review/approval**: would require a write endpoint; none exists. **OPEN ENGINEERING DEPENDENCY.**

The one thing Phase 8 *can* safely do now, with zero backend dependency: make the existing single-shot AI insight experience (already well-separated visually, §8) feel more like a deliberate "ask and receive a grounded answer" moment — better entry framing, clearer "this is AI, here's what's verified vs. not" storytelling — without inventing any capability the backend doesn't have.

## 21. Open engineering dependencies (consolidated)

Every item below requires a backend/API change and is explicitly **not** something Phase 8 UI/UX work can resolve on its own:

1. **No endpoint lists distinct brand names** — blocks a genuine BrandsIndex search experience beyond an exact-name-required or client-side-history stopgap.
2. **Problems returns no product/evidence identifiers** — blocks any drill-down from a theme to its underlying products or reviews.
3. **No `theme` filter on Rankings** — blocks a clean "show me the products behind this Problems theme" cross-link even if Problems' own response doesn't add identifiers.
4. **No time-series/trend-line data anywhere** — blocks any real trend chart beyond the existing single-window-vs-prior-period comparison.
5. **No review text/title/author on any endpoint** — blocks any "read the actual evidence" experience; evidence will always be ID/citation-count only.
6. **No severity/risk score** — blocks any unified priority-ranked "top N things to look at" view that isn't itself dressed-up honesty about using real, already-returned magnitudes (delta, mentionCount, trendScore) instead.
7. **No conversational/streaming/retrieval AI capability** — blocks the entire "Future AI Analyst" concept (§20).
8. **No write endpoints of any kind** — blocks acknowledgement/dismissal/recommendation-approval/notifications.
9. **`product_family_mapping` is empty by design** — not a bug, but means Product Marketplace Comparison will realistically always show `NoMappingState` in real data until a business decision (not an engineering one) populates it.

## 22. Phase 8 implementation order

The proposed order from the master prompt is **confirmed as the right sequence** by this audit — design system/shell first (it's the highest-leverage, lowest-risk change and everything downstream depends on it), functional pages in roughly their journey order, evidence/AI experience after the pages that feed it exist, then hardening passes last. One adjustment: performance's single biggest win (route-level code-splitting, §11/§15) has zero dependency on the design-system work and could be pulled earlier if you want the perceived-performance win sooner — noted as an option, not a change to the proposed order below unless you say otherwise.

0. Audit + transformation plan *(this document)*
1. Design system + application shell (tokens, dark mode wiring, `StatusBadge` consolidation, typography h3, header/sidebar polish)
2. Executive Dashboard transformation
3. Product Rankings transformation
4. Product Intelligence (Product Detail) transformation — including the anchored/tabbed restructure
5. Early Warnings transformation
6. Problems transformation (honest dead-end framing, per §16/§19 — no fabricated drill-down)
7. Marketplace Comparison transformation (BrandsIndex interim fix, consolidated platform card, both comparison pages)
8. Evidence investigation experience (Evidence drawer/Sheet, ID/citation-count only, per §19/§20's hard ceiling)
9. AI experience foundation / future AI UX direction (visual/framing polish only — no new capability, per §20)
10. Responsive + accessibility hardening (reduced-motion, `scope="col"`, `aria-sort`, Warnings landmarking, chart `ResponsiveContainer`, desktop-only pages)
11. Performance optimization + measurement (route-level code-splitting, real bundle/paint measurement — this is where §11's numbers get re-measured post-change, not before)
12. Final visual/UX validation
13. Phase 8 final report

## 23. Risks

- **Scope creep into fabricated capability.** The master brief explicitly names "evidence storytelling" and "AI experience" as goals, but §4/§20 show hard backend ceilings on both. The risk is a later step quietly inventing review-text display, streaming AI, or a severity score to "make it feel more complete." Mitigation: every step's report must classify claims per the evidence vocabulary, and any UI element not traceable to a real field must be rejected in review, exactly as Phases 3–7 already enforced.
- **Component consolidation (§18) touching every page at once.** Merging 4 badges into 1 and 2 cards into 1 is a good idea but changes shared code that all 9 pages depend on — regression risk is real if not sequenced carefully behind the full existing test suite (205 frontend tests) at every step.
- **Bundle code-splitting (§11/§22 step 11) interacting with existing route-level tests.** `tests/routes/routing.test.tsx` renders the real router tree; introducing `React.lazy()` changes how those tests need to await rendering (lazy chunks resolve asynchronously) — a real, known Vitest/RTL pattern, but must be handled deliberately, not accidentally break that test file.
- **Dark mode wiring** touches every hardcoded literal-color badge (§14.1) — if badges aren't migrated to token-based colors in the same step, dark mode could look inconsistent (some elements re-themed, badges frozen to their light-mode hardcoded values). §17/§18 should land together for this reason.
- **"Unified attention feed" (§16)** risks becoming a subtle re-ranking/analytics computation if not scoped tightly to "presentational sort of already-real numbers" — must be reviewed with the same rigor as the Warnings signal-type-filter precedent from Phase 7.

## 24. Validation strategy

Every subsequent Phase 8 step must, at minimum, reproduce this session's baseline before claiming success:

- Frontend `tsc -b`: clean
- Frontend full test suite: currently 205/205 (**PROVEN BY EXECUTION**, this session) — must not regress; new tests added per changed component/page, existing tests updated (not weakened) when a stub-era assertion becomes stale, exactly per the Phase 7 precedent (routing.test.tsx updates in Steps 7/8/9)
- Frontend `npm run build`: must succeed; bundle-size change must be **measured and reported**, not assumed, especially once code-splitting (step 11) lands
- Backend `tsc --noEmit`: clean (backend should not need to change at all during Phase 8 per its strict scope — any step that finds itself needing a backend change must stop and report an Open Engineering Dependency instead, per your explicit instruction)
- Backend full test suite: currently 308/308 (**PROVEN BY EXECUTION**, this session) — must remain exactly 308/308 unless you explicitly approve a backend change
- Backend `npm run safety-check`: OK (**PROVEN BY EXECUTION**, this session)
- Zero AI calls per step (frontend-only work should never trigger `.../insights`)
- Zero production access, zero database writes
- Each step's report follows the reporting standard specified in the master prompt exactly, with the same evidence-classification discipline used throughout Phases 3–7

**Baseline recorded this session (PROVEN BY EXECUTION):**

| Check | Result |
|---|---|
| Frontend `tsc -b` | Clean |
| Frontend test suite | 205/205 |
| Backend `tsc --noEmit` | Clean |
| Backend test suite | 308/308 |
| Backend `npm run safety-check` | OK |
| Frontend `npm run build` | Succeeded — 865.34 KB JS (258.93 KB gzip), 79.33 KB CSS, chunk-size warning fires |

All values match the expected known baseline you provided exactly. No investigation was triggered.

---

**Phase 8 Step 0 is complete.**

No frontend code, backend code, or database was modified. No dependencies were installed. No pages were redesigned. No AI provider was called. Nothing was deployed.

Waiting for your explicit approval — and your decisions on the open questions in §21/§22 (in particular, whether the small Rankings `theme`-filter addition suggested in §16 is something you want raised as its own backend-change request, or left as a documented limitation) — before Step 1 begins.
