# Phase 8 — Step 1 — Design System + Application Shell — Report

**Scope:** frontend only — design tokens, the shared status-badge system, dark mode, the application shell (sidebar/header), shared state components, and the accessibility/data-trust fixes that belong to that shared infrastructure. No individual page was redesigned. Backend, database, AI provider, and deployment were not touched.

Status vocabulary: **PROVEN BY EXECUTION** / **UNIT-TEST PROVEN** / **OBSERVED** / **NOT MEASURED** / **INFERRED**.

---

## 1. Objective

Establish the visual and interaction foundation every later Phase 8 step will inherit: a coherent, token-based design system (including a working dark mode); one shared status-badge primitive replacing four independently-hardcoded implementations; a shell (sidebar + header) that reads as a journey rather than an API directory; and shared loading/empty/error state components with guaranteed visual consistency — without inventing any capability the backend doesn't have, and without redesigning Dashboard, Rankings, Product Detail, Warnings, Problems, Marketplace, Evidence, or AI experience (all explicitly deferred to their own steps).

## 2. Before-state findings (re-confirmed from the Step 0 audit, not assumed)

- 4 badge components (`ConfidenceBadge`, `SignalBadge`, `MarketplaceBadge`, `SystemStatusBadge`) each hardcoded their own literal Tailwind colors; a real but unformalized 3-tone vocabulary existed by convention, with `SignalBadge`'s orange and `SystemStatusBadge`'s red as un-integrated outliers.
- A complete `.dark` token block existed in `index.css` but nothing in the codebase ever toggled it — dead CSS.
- The sidebar was one flat "Navigate" group; the header's `title` prop was declared but never passed by any page — dead code.
- `SentimentDistribution`'s partial-null coalescing defect (found in Step 0 §8) was **not** touched this step, per your Step 1M instruction, since this step never opens that component — deferred to whichever page step renders it.
- Baseline recorded before any change: frontend 205/205, backend 308/308, both typechecks clean, safety-check OK, build 865.34 KB JS (258.93 KB gzip) / 79.33 KB CSS.

## 3. Design decisions

- **Improve, don't replace, the existing blue-indigo OKLCH identity.** `--primary`/`--accent`/`--sidebar-*` and the hue-258 foundation are untouched — the task explicitly warned against destroying it without a strong reason, and none exists.
- **Semantic status color is deliberately decoupled from brand color and from severity.** Three new tone families (`success`, `warning`, `info`) plus the existing `--destructive` (aliased as `danger`) and `--muted` (aliased as `neutral`) form the complete status vocabulary. No "severity" scale was created — the backend has no severity field (Step 0 §4), and Step 1A explicitly forbade inventing one. Tone assignment is a presentational choice per badge, never a claim about data that doesn't exist (e.g., "medium confidence" reading as the `info` tone is not a statement that medium confidence is somehow less real than high).
- **AI and Evidence tokens were added but not consumed.** Per Step 1A's request to reserve visual identity for `DATA`/`EVIDENCE`/`AI`/`RECOMMENDATION`, `--ai-*` (violet, matching what `AIInsightCard` already uses) and `--evidence-*` tokens now exist in `index.css`, but **no component was wired to them this step** — `AIInsightCard`/`EvidenceList` belong to Steps 8–9 per the approved implementation order, and touching them now would be exactly the "individual page/experience redesign" this step was told not to do.

## 4. Token changes

`frontend/src/index.css` — added to both `:root` and `.dark`: `--success-bg/-fg/-border`, `--warning-bg/-fg/-border`, `--info-bg/-fg/-border`, `--ai-bg/-fg/-border`, `--evidence-bg/-fg/-border` (15 new custom properties × 2 modes = 30 values), each wired into the `@theme inline` block as `--color-*` so they're usable as ordinary Tailwind utilities (`bg-success-bg`, `text-warning-fg`, etc.). Added a global `@media (prefers-reduced-motion: reduce)` rule. No existing token was removed or renamed.

## 5. Typography changes

Defined (and documented here, for later steps to inherit) the hierarchy requested in Step 1C:

| Tier | Treatment | Where applied this step |
|---|---|---|
| Page title | `text-xl font-semibold tracking-tight` | Unchanged (already this way on all 9 pages; no page touched) |
| Section title | `text-sm font-semibold` | Unchanged (page-level JSX, deferred to page steps) |
| Metric | `text-2xl font-semibold tabular-nums` | `MetricCard` (unchanged, already correct) |
| Metric label | `text-xs font-medium tracking-wide text-muted-foreground uppercase` | `MetricCard` — **changed this step** (was plain-case `text-sm`) |
| Body / supporting text | `text-sm` / `text-xs text-muted-foreground` | Unchanged |
| Table | `text-sm`, `tabular-nums` on numeric cells | Unchanged (already consistent per Step 0 §5) |
| Badge | `text-xs font-medium` | `StatusBadge` (consolidated, see §6) |
| Evidence metadata / AI content / recommendation | Not defined this step | Reserved for Steps 8–9, which own those components |

`MetricCard`'s label is the only rendered-text tier actually changed — a `className` change only, exact same DOM text content, so no page test needed updating for this.

## 6. Badge/status changes

Created `frontend/src/components/intelligence/StatusBadge.tsx` — one shared primitive (`{tone, icon, label}` → icon + token-colored pill + text, status never color-only). `ConfidenceBadge`, `SignalBadge`, `MarketplaceBadge`, `SystemStatusBadge` were rewritten as thin `CONFIG` lookups over it — **every public prop, every rendered label string, and every real-backend-value-to-meaning mapping is unchanged**; only the color implementation moved from hardcoded literals to tokens. Two real color-vocabulary outliers were resolved: `SignalBadge`'s one-off orange became the shared `warning` tone (still meaning "this signal fired," not "this is worse than another signal" — no ranking was introduced), and `SystemStatusBadge`'s unused `red-*` became `danger` (`--destructive`). `IngestionWatermarksTable` and `AiUsageTable` (System page) were moved off the generic shadcn `Badge` `variant` prop onto `StatusBadge` with a literal per-value tone mapping (`idle`→neutral, `running`→info, `success`→success, `partial_failure`→warning, `failed`→danger) — the exact literal status text rendered (`"running"`, `"partial failure"`, etc.) is unchanged, confirmed by the existing System tests continuing to pass unmodified.

## 7. Dark-mode changes

Hand-rolled `ThemeProvider`/`useTheme` (`frontend/src/providers/ThemeProvider.tsx`) — no new dependency (see §14). Supports `light`/`dark`/`system`, persists to `localStorage`, listens for OS preference changes while in `system` mode, and toggles the `.dark` class + `document.documentElement.style.colorScheme`. A synchronous inline script was added to `index.html` (before `#root`) that applies the same resolved class prior to the first paint, avoiding a flash of the wrong theme — kept in exact logical sync with the provider's own resolution logic, both reading the same `theme` `localStorage` key. `ThemeToggle` (`frontend/src/components/layout/ThemeToggle.tsx`) is a 3-way accessible control built on the already-installed `DropdownMenu`/`DropdownMenuRadioGroup` primitives, added to `AppHeader`. Because every badge now uses token-based colors (§6) rather than hardcoded literals, dark mode is correct for every status badge in the app, not just the pages that happen to get redesigned later.

## 8. Shell/header/sidebar changes

Created `frontend/src/routes/navigation.ts` as the single source of truth for navigation — `AppSidebar` now renders 3 grouped sections (**Command Center**: Overview; **Investigate**: Products, Warnings, Problems; **Compare**: Marketplace) plus a conditional **Admin** group (System), reflecting the WHAT→WHY→EVIDENCE→NEXT journey model from the Step 0 plan §16. **No route, href, label, or destination was added, removed, or renamed** — this is presentational grouping of the exact same 6 items Phase 7 already had. `AppHeader` now derives the current section's label automatically from the route (via a longest-prefix match against the same nav config) instead of the dead, never-passed `title` prop, and gained the `ThemeToggle`. Per §1G's explicit instruction, **no AI entry point and no search box were added** — both would be non-functional placeholders today (Step 0 §21 confirms no backend capability exists for either), and the header's structure doesn't need a reserved visual slot to accommodate them later.

## 9. Shared-state changes

Created `frontend/src/components/states/DashedState.tsx` with two internal base components — `DashedStatePanel` (the large centered "nothing here" block, used by `EmptyState`/`NoMappingState`) and `DashedStateNotice` (the compact inline aside, used by `InsufficientDataState`/`NotReadyState`) — guaranteeing those two families can never visually drift apart from each other again. `EmptyState`, `NoMappingState`, `InsufficientDataState`, and `NotReadyState` were rewritten on top of these; every prop, icon default, and rendered copy string is unchanged. **The distinction between `null`/`insufficient_data`/`not_ready`/`no_mapping`/`empty`/`error` was not touched or collapsed anywhere** — each still has its own component and its own real backend meaning; only their internal implementation was deduplicated. `LoadingState` and `ErrorState` were reviewed and left as-is — both were already consistent with each other and with the rest of the system (role="status"/aria-busy/aria-live on loading; icon+title+description+optional-Retry on error) and needed no structural change.

## 10. Accessibility changes

- `frontend/src/components/ui/table.tsx`: `TableHead` now defaults to `scope="col"` — every table in the app (Rankings, Problems, Theme Consistency, Ingestion, AI Usage) gets correct header/data-cell association for screen readers, with zero per-table code change required, since all of them already render column headers exclusively.
- Global `prefers-reduced-motion: reduce` handling added in `index.css` (§4) — previously entirely absent, per Step 0 §9.
- `ThemeToggle` is a native `<button>` with `aria-label="Change theme"`, fully keyboard-operable (Tab to focus, Enter/Space to open, arrow keys + Enter to select — inherited from Radix's `DropdownMenuRadioGroup`), verified in tests (§15).
- The header's section-context label is a `<span>` with an `aria-hidden` icon and real text — no new landmark/heading-depth regression was introduced.

Not addressed this step (explicitly out of scope — belongs to the individual pages that have the problem, per Step 0 §9/§22 step 10): Warnings' missing `aria-labelledby` section wrapper, `aria-sort` on sortable Rankings columns, and heading-depth (`h3`) additions inside per-page stat blocks.

## 11. Responsive changes

No structural responsive change was made to the shell — it was already the one genuinely well-built responsive element in the app (Step 0 §10: a real 768px breakpoint switching between the fixed desktop sidebar and a `Sheet` overlay, built on shadcn's own primitive). `ThemeToggle` and the header's section label both degrade gracefully at narrow widths (the dropdown is a floating overlay, not a layout-affecting element; the section label is a single `<span>` that wraps normally). Per-page responsive gaps (desktop-only `Problems`/`Products`/`System`, fixed-pixel charts, fixed-column stat grids) were **not** touched — Step 0 §10/§22 assigns that to step 10 (dedicated responsive hardening) and to each page's own transformation step.

## 12. Files created

- `frontend/src/providers/ThemeProvider.tsx`
- `frontend/src/components/layout/ThemeToggle.tsx`
- `frontend/src/components/intelligence/StatusBadge.tsx`
- `frontend/src/components/states/DashedState.tsx`
- `frontend/src/routes/navigation.ts`
- `frontend/tests/providers/ThemeProvider.test.tsx` (6 tests)
- `frontend/tests/components/StatusBadge.test.tsx` (3 tests)
- `frontend/tests/components/ThemeToggle.test.tsx` (4 tests)
- `docs/implementation/phase-8-step-1-design-system-shell-report.md` (this report)

## 13. Files modified

`frontend/index.html`, `frontend/src/index.css`, `frontend/src/app/App.tsx`, `frontend/src/components/intelligence/{ConfidenceBadge,SignalBadge,MarketplaceBadge,SystemStatusBadge,IngestionWatermarksTable,AiUsageTable,MetricCard}.tsx`, `frontend/src/components/ui/table.tsx`, `frontend/src/components/states/{EmptyState,NoMappingState,InsufficientDataState,NotReadyState}.tsx`, `frontend/src/components/layout/{AppSidebar,AppHeader}.tsx`, `frontend/tests/routes/routing.test.tsx` (7 new tests + the `ThemeProvider` wrapper fix described in §16).

No backend, database, migration, or deployment file was touched.

## 14. Dependencies added/removed

**None.** Dark mode was hand-rolled (§7) specifically to avoid adding `next-themes` or any similar package — this is a pure client-rendered SPA with no SSR-flash concern beyond what the inline `index.html` script already solves, and the amount of code required (a ~70-line provider) was small enough that an existing-primitives-only approach (per Step 1L's explicit preference) was clearly sufficient. The theme control itself reuses the already-installed `DropdownMenu`/Radix primitives. `package.json`/`package-lock.json` are untouched — confirmed via `git diff --stat`.

## 15. Tests

**20 new tests, 225/225 total (PROVEN BY EXECUTION)** — 205 pre-Step-1 baseline + 20 new:
- `ThemeProvider.test.tsx` (6): defaults to `system`/resolves via the test-environment's polyfilled `matchMedia`; reads a stored preference on mount; an invalid stored value falls back to `system` rather than throwing; `setTheme` both applies the `.dark` class and persists to `localStorage`, in both directions; `useTheme` throws outside its provider (fails loud, consistent with the rest of the app's badge-`CONFIG` philosophy from Step 0 §8).
- `StatusBadge.test.tsx` (3): renders the exact label passed in (never a tone-derived label); applies token-based classes and never a hardcoded literal color; every one of the 5 tones renders without crashing and always pairs an icon with text.
- `ThemeToggle.test.tsx` (4): accessible labeled trigger; all 3 real options present; selecting Dark applies the class and persists; keyboard-operable (Tab + Enter).
- `routing.test.tsx` (+7): sidebar renders the 3 new group labels with every existing route still reachable at its original href; the Admin group label appears only for `admin` and not for `viewer`; the header shows the correct derived section label for both a top-level route and a nested drill-down route, and shows none for a route with no matching nav entry at all; the header renders the accessible theme control.

**No existing test was weakened.** One existing test file (`routing.test.tsx`) required a harness fix, not a weakened assertion — its `renderAt` helper renders the router tree directly (not through the real `App.tsx`), so it needed `ThemeProvider` added to its own wrapper once `AppHeader` started requiring that context; every original assertion in that file is unchanged.

## 16. Typecheck

`tsc -b`: clean (**PROVEN BY EXECUTION**).

## 17. Build

`npm run build`: succeeded. **865.34 KB → 881.73 KB JS** (258.93 KB → 263.11 KB gzip), **79.33 KB → 80.01 KB CSS**, `index.html` 0.47 KB → 1.37 KB (the inline theme script). The ~16 KB JS increase is fully attributable to the new provider/toggle/token/navigation code added this step — no new dependency was installed (§14), so none of the increase is third-party library weight. The pre-existing >500 KB chunk-size warning still fires, unchanged in cause (no code-splitting was attempted this step, per Step 1L's explicit instruction that it belongs to a later, dedicated performance step) (**PROVEN BY EXECUTION**).

## 18. Backend regression

**308/308 passing, unchanged.** Backend `tsc --noEmit`: clean. No backend file was modified this step (**PROVEN BY EXECUTION**).

## 19. Safety check

`npm run safety-check`: `OK — no write-shaped SQL found in database/prodReadOnly/` (**PROVEN BY EXECUTION**).

## 20. Database safety

Zero database queries were run this step — nothing in Step 1's scope touches the backend or database at all, so there was nothing to verify beyond re-confirming the backend test/typecheck/safety-check baseline above.

## 21. AI call count

**Zero.** No AI provider was invoked; no test in this step mocks or exercises `.../insights`; `AI_PROVIDER` was not read or changed by anything in this step.

## 22. Production-access confirmation

No production access of any kind — this step never left the frontend working tree.

## 23. Defects found/fixed

No product-code defect was found or fixed this step (the one real defect from the Step 0 audit, `SentimentDistribution`'s partial-null coalescing, was deliberately left untouched per §1M/§2, since this step never opens that component). One test-infrastructure gap was found and fixed: `routing.test.tsx`'s render helper didn't provide `ThemeProvider`, which the real app now requires at the shell level — fixed by adding it to the helper (§9/§15), not by weakening the assertions that depend on it.

## 24. Known limitations

- Dark mode has no automated visual-regression check — correctness was verified via the `.dark` class + token-application logic (unit-tested) and via the design decision to route every badge through the shared token system (§6), not via a rendered-pixel comparison. **NOT MEASURED**: actual visual appearance in a real browser.
- `AI`/`Evidence` tokens exist but are unconsumed until Steps 8–9 — intentional, not an oversight (§3).
- Per-page accessibility/responsive gaps identified in Step 0 (Warnings' missing landmark, fixed-pixel charts, desktop-only pages, `aria-sort`) remain exactly as documented — this step only fixed the subset that lives in shared/shell infrastructure (§10/§11).
- No visual quality-bar user testing was performed — the 14-point checklist in the master prompt was self-evaluated against the design decisions in this report, not measured against real users. **NOT MEASURED.**

## 25. Evidence classification

- **PROVEN BY EXECUTION**: typecheck, full test suite (225/225), build output and byte deltas, backend regression (308/308), safety-check, dependency-diff confirmation.
- **UNIT-TEST PROVEN**: theme persistence/resolution/class-toggling, badge tone-to-class mapping, keyboard operability of the theme control, nav-group presence and href correctness, header section-label derivation.
- **OBSERVED**: before-state findings restated from the Step 0 audit (badge duplication, dead dark-mode CSS, dead header prop) — re-confirmed by reading the actual pre-edit source in this step, not assumed from the prior report.
- **NOT MEASURED**: real rendered visual appearance/dark-mode correctness in an actual browser, real user perception of the 14-point quality bar, real perceived-performance impact of the ~16 KB bundle increase.

---

**Phase 8 Step 1 is complete.**

Design system, dark mode, shared status-badge system, shell (sidebar/header), and shared state components are done. No individual page was redesigned. No backend, database, or AI provider was touched. No new dependency was added.

Waiting for your explicit approval before Step 2 (Executive Dashboard transformation).
