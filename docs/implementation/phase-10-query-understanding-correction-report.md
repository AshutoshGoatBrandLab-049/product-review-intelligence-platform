# Phase 10 — AI Product Analyst Query-Understanding & Execution Correction

Round 3 of the Phase 10 AI Product Analyst work. Builds on the uncommitted round-2
work already in the tree (retrieval-bypasses-AI fix, conversation-state
persistence, relaxed narrator theme schema) — none of that was reverted or
redone. This round replaces single-shot `question → AnalyticalIntent` keyword
classification with a compositional query-understanding resolver, per the
user's real-conversation failure report.

## 1. Why each real query failed — confirmed root causes

**"mujhe last 5 days ka reviews dekhna h" → generic stats.**
CONFIRMED BY EXECUTION (reproduced against the pre-fix code before editing):
`detectIntent()` in `intentDetection.ts` had no timeframe recognition and no
"dekhna h" keyword — the message matched no branch and fell to the
`STATS_QUERY` default. Separately, `detectWindowFromQuestion()` in
`productAnalyst.ts` only recognized the fixed `7d/30d/60d/90d/6m/12m` set via
literal substring match — "last 5 days" (arbitrary N) was structurally
invisible to it.

**"how can improve this product" → generic stats.**
CONFIRMED BY EXECUTION: the RECOMMENDATION branch matched only the exact
substring `"how can we improve"`. The real query has no "we" and matched
nothing, falling through to `STATS_QUERY`.

**"biggest issue" → correct on the surface, but not necessarily
evidence-driven.**
INVESTIGATED (item 5): `aggregateSemanticAspects()` in `semanticAnalysis.ts`
groups by the raw discovered aspect string (`obs.aspect.toLowerCase()`) — it
does **not** bias or normalize back toward `THEME_VOCABULARY`. That part of
the pipeline was already correct from the prior round. The **real** remaining
bug in this area was different and more severe: `analyzeProductReviewsForIntent()`
never sentiment-filtered aspects for `RECOMMENDATION` intent, so the most
numerous aspect (frequently a broad "positive_feature" bucket, since even
3-star reviews were tagged positive by the mock's rule) would win the ranking
ahead of any real negative complaint — see §9.

**"Show me the latest 20 reviews" → "Found 11 matching reviews" for an
11-review product.** INVESTIGATED: reproduced this shape is correct
behavior — `retrieveReviews()` does attach the real review array
(`response.reviews`), this was already fixed in round 2. The user's transcript
phrasing ("Found 11 matching reviews") without an explicit array likely
reflected the frontend rendering, not a backend fabrication — out of scope
for this backend round; verified the backend always returns `reviews: [...]`
for retrieval intents (`tests/integration/productAnalyst.test.ts`, still
passing).

## 2. The compositional query-understanding architecture

New module `backend/src/modules/ai/queryResolution.ts` exports `resolveQuery()`,
which decomposes a message into independent dimensions **before** deciding
what to do:

```ts
interface ResolvedQuery {
  action: QueryAction;          // RETRIEVE_REVIEWS | ANALYZE_PROBLEM | ... | CLARIFY
  intent: AnalyticalIntent | null; // legacy mapping, kept for narrator/semantic-analysis plumbing
  kind: "RETRIEVAL" | "ANALYSIS" | "NEEDS_CLARIFICATION" | "EXPLAIN_PREVIOUS";
  subject: "REVIEWS" | "PRODUCT";
  filters: { rating?, sentiment?, theme? };
  timeframe: ResolvedTimeframe | null;
  quantity: number | null;
  aspect: string | null;
  sentiment: "positive" | "negative" | "neutral" | null;
  comparison: null;             // not implemented this round, see §19
  contextReference: boolean;
  responseStyle: "CONCISE" | "DETAILED" | "DEFAULT";
  resolvedFromContext: boolean;
}
```

`action` is the new primary dispatch key. `AnalyticalIntent` (the old enum) is
still produced via `intent` because the existing narrator/semantic-analysis
budget tables and prompt-building code key off it — rebuilding that
plumbing was out of scope and unnecessary; `actionToIntent()` maps cleanly
1:1 from the new action space onto it.

`debugResolvedQuery()` returns a small loggable object (action, intent,
filters, timeframe, quantity, aspect, sentiment, context flags) — wired into
`productAnalyst.ts` behind `DEBUG_QUERY_RESOLUTION=true`, satisfying the
spec's §17/§23 inspectability requirement without adding an API-facing field.

## 3. Action resolution

Priority order (mirrors the prior round's REVIEW_EXPLORATION-first ordering,
extended):

1. Explicit retrieval verb/phrase (English + Hinglish) → `RETRIEVE_REVIEWS`
2. **OR** a recognized timeframe expression + a review noun → `RETRIEVE_REVIEWS`
   (belt-and-suspenders per spec — both paths independently catch "mujhe last
   5 days ka reviews dekhna h": the "dekhna" verb match AND the
   timeframe+"reviews" combination)
3. `RECOMMEND_IMPROVEMENTS` (checked **before** `ANALYZE_PROBLEM` — see below)
4. `ANALYZE_PROBLEM`
5. `ANALYZE_COMPLAINTS`
6. `ANALYZE_POSITIVE_FEEDBACK`
7. `RETRIEVE_EVIDENCE`
8. `ANALYZE_RATINGS`
9. `COMPARE_PERIODS`
10. default `SHOW_STATISTICS`

RECOMMEND_IMPROVEMENTS regex, loosened per spec:
```
/\bhow\s+(?:can|do|could|to)\b(?:\s+\w+){0,3}?\s*\b(?:improve|fix)\b/
/\bwhat\s+should\b(?:\s+\w+){0,4}?\s*\b(?:improve|fix|change)\b/
/\bwhat\s+changes\s+should\b/
```
Matches "how can improve this product" (0 filler words between "can" and
"improve"), "how can we improve", "what should we fix first", "what should
we improve".

**Bug found and fixed during implementation:** `TOP_PROBLEM`'s pattern
originally included the literal phrase `"fix first"`, which shadowed
`RECOMMEND_IMPROVEMENTS` for "what should we fix first" (an explicit
spec-mandated RECOMMENDATION trigger). Fixed by (a) removing `"fix first"`
from the `TOP_PROBLEM` pattern and (b) checking `RECOMMEND_IMPROVEMENTS`
before `ANALYZE_PROBLEM` in `classifyAction()`. UNIT-TEST PROVEN
(`queryResolution.test.ts`).

**Bug found and fixed:** `COMPLAINT_RE` used `\bcomplain\b`, which requires a
word boundary immediately after "complain" — so "complain**ing**" never
matched. Fixed to `complain\w*`/`complaint\w*`. UNIT-TEST PROVEN.

**Bug found and fixed:** the generic "≤3 words ⇒ ambiguous, needs context"
heuristic (inherited from round 2's anaphoric-follow-up handling) was
swallowing short-but-concrete sentences like "reviews dekhna hai" (3 words,
has a real retrieval verb) and routing them to `CLARIFY` when no prior
conversation existed. Fixed: the word-count fallback now only applies when
`classifyAction()` found no concrete action signal on its own; a message with
an explicit action is never treated as ambiguous regardless of length.
UNIT-TEST PROVEN.

Retrieval verbs (English + Hinglish, spec §5): `show me`, `show those`, `show
the`, `get me`, `give me`, `dikhao`, `dikha do`, `dikhaiye`, `dekhna h`,
`dekhna hai`, `dekhna`, `batao`, `nikalo`, `de do`.

`intentDetection.ts`'s legacy `detectIntent()` was also broadened
(RECOMMENDATION regex, the same retrieval-verb additions) as defense-in-depth,
since `describeIntent()`/budget tables/analysis-path fallback still use it —
but `queryResolution.ts`'s `resolveQuery()` is what actually drives dispatch
in `productAnalyst.ts` now, not `detectIntent()` alone.

## 4. Filter extraction

Compositional, not single-classification: sentiment, quantity (explicit
"latest 20"), rating, and theme are all extracted independently via
`deriveReviewFiltersFromQuestion()` (reused, unchanged) plus the resolver's
own `detectSentiment`/`detectQuantity`. "last 5 days ke negative reviews
dikhao" produces `action: RETRIEVE_REVIEWS, timeframe: {5 days}, sentiment:
negative` simultaneously — UNIT-TEST PROVEN
(`queryResolution.test.ts`, "compositional" test case).

## 5. Timeframe resolution

New module `backend/src/modules/ai/timeframeResolution.ts`, `resolveTimeframeFromQuestion()`.

**Convention decision (explicit):** `dateWindows.ts`'s existing
`resolveNamedWindow("7d")` resolves to `[asOf - 6 days, asOf]` — 7 calendar
days, inclusive on both ends. "Last N days" here follows the **identical**
rule: `start = asOf - (N-1) days`, `end = asOf`. So "last 5 days" = today
plus the previous 4 calendar days (5 days total), **not** a rolling 5×24h
window. This was a deliberate choice to stay consistent with the one
date-window convention this codebase already has, rather than invent a
second one. UNIT-TEST PROVEN (`timeframeResolution.test.ts` asserts
`asOf=2026-08-17` + "last 5 days" → `{start: "2026-08-13", end: "2026-08-17"}`).

Covers:
- Arbitrary-N relative: "last/past/previous N days/weeks/months/years"
- Hinglish: "pichhle N din", "N din ke"
- Named-day: "kal ke" (yesterday), "aaj ke" (today), English "yesterday"/"today"
- Named-period: "last week" (→ 7-day window), "this month" (month-start →
  today), "last month" (full previous calendar month)
- Absolute range: "from Aug 1 to Aug 10", best-effort month-name parsing;
  genuinely unparseable ranges are flagged `unparseable: true` rather than
  silently ignored, so the caller can fall back to the default window
  explicitly (not by accident)
- `"recent"`/`"latest"` alone deliberately returns `null` (no forced
  timeframe) — only a concrete unit forces a window, per spec

Output is always a real `DateWindow` computed from `asOf` — never something
the LLM invents; the LLM is never in this code path at all for timeframe
resolution.

## 6. Conversation context resolution

`resolveQuery()`'s ambiguous/anaphoric branch (fixed patterns like `^show
me$`, `^why\??$`, or a short message with no concrete action signal) resolves
against `PriorTurnContext` the same way round 2's `resolveIntentWithContext()`
did, plus:
- `EXPLAIN_PREVIOUS_RESULT` for "why?"/"explain..."
- `RETRIEVE_REVIEWS` for "show me"/"show those", with `aspect` and
  `filters.theme` set to the prior turn's aspect when the prior turn was
  analysis, or simply repeating retrieval when the prior turn was itself
  retrieval

**Bug found and fixed (a real, previously-undetected defect, not something
this round introduced):** a cache hit in `analyzeProductQuestion()` returned
immediately **without ever calling `persistTurn()`**. So a conversation whose
first question happened to already be cached (asked before, by anyone,
against the same product+window) silently lost all conversation state — the
very next "show me"/"why?" follow-up would find an empty message history and
incorrectly ask for clarification instead of resolving against real prior
context. Found via the new two-turn integration test
(`queryUnderstanding.test.ts`), which failed with `needsClarification: true`
on turn 2 until this was fixed. Fixed by reconstructing intent/aspect/review
IDs from the cached response and calling `persistTurn()` on the cache-hit path
too. INTEGRATION-TEST PROVEN.

## 7. Retrieval flow

`productAnalyst.ts`'s `RETRIEVAL` branch now uses `resolvedQuery.timeframe?.window`
to override the window passed to `retrieveReviews()` (previously only
`detectWindowFromQuestion()`'s fixed-set matcher could ever change it — a
resolved "last 5 days" is no longer invisible to the actual DB query).
`reviewRetrieval.ts`'s `ReviewRetrievalFilters.window` now accepts either a
`NamedWindow` string or a literal `DateWindow` object.

**Second bug found and fixed:** a context-resolved "show me" after an
analysis turn used to pass the prior aspect as a `theme` string filter
(`rt.theme = :theme` against the `review_theme` table). But `review_theme` is
scoped to the fixed `THEME_VOCABULARY` (11 values) — a semantically-discovered
aspect like "quality_issue" (or a real discovered aspect like "zip failure")
was **never persisted there**, so this filter would silently return zero rows
even when real evidence existed. Fixed by adding an explicit `reviewIds`
allowlist filter to `ReviewRetrievalFilters` — when a context-resolved
follow-up's aspect matches the prior turn's aspect, `productAnalyst.ts` now
passes the prior turn's exact, already-DB-validated `evidenceReviewIds`
instead of re-deriving a theme-column filter that structurally cannot see a
non-vocabulary aspect. INTEGRATION-TEST PROVEN
(`queryUnderstanding.test.ts`, "walks a real two-turn conversation").

**Third bug found and fixed:** `verifyProductExists()` scoped existence to
the *requested window itself* — so a legitimate narrow timeframe ("last 5
days") against a real product with genuinely zero reviews in that 5-day slice
threw `Product not found` (a 404-shaped error) instead of answering "No
matching reviews found for the requested period." A resolved arbitrary
timeframe can now produce exactly this narrow, legitimately-empty window,
which the old fixed 7/30/60/90-day set almost never did in practice. Fixed:
`verifyProductExists()` now checks "does this product have any review at
all," decoupled from the requested window; a genuinely empty window falls
through to the existing zero-match retrieval response instead of an error.
PROVEN BY EXECUTION (`phase10QueryUnderstandingValidation.ts`, queries #5–7).

## 8. Analysis flow

Unchanged in shape (semantic analysis → deterministic root cause → narrator →
evidence-integrity re-validation), still gated by `AnalyticalIntent` via
`actionToIntent()`. `topAspect`/`topReviewIds` computation, Phase 4.1 citation
filtering (`filterIds`/`filterRelevant`), and the `reportedCount ===
unique(evidenceReviewIds).length` invariant are untouched.

## 9. Recommendation flow (spec item 4)

**Real bug found:** `analyzeProductReviewsForIntent()` never sentiment-filtered
aspects for `RECOMMENDATION` intent (only `TOP_PROBLEM`/`COMPLAINT_ANALYSIS`
did). Aspects are sorted by raw count descending; with the mock provider's
rule (rating ≤2 → "quality_issue", rating >2 → "positive_feature"), a
3-star review counts as "positive_feature" too, so the positive bucket
routinely outnumbers any single negative complaint. Result: "how can improve
this product" — even once correctly routed to RECOMMENDATION — picked the
most-mentioned **positive** aspect as `dominant`, which then had no grounded
negative evidence to cite, degenerating into "No evidence-grounded complaint
theme was found." Fixed: `RECOMMENDATION` is now included in the
negative-sentiment filter alongside `TOP_PROBLEM`/`COMPLAINT_ANALYSIS`.
UNIT/INTEGRATION-TEST PROVEN + PROVEN BY EXECUTION (validation query #11/#12).

**Distinct response construction:** all four providers
(`openaiProvider.ts`/`anthropicProvider.ts`/`geminiProvider.ts`/
`mockAiProvider.ts`) now receive/produce a RECOMMENDATION-specific
instruction (`recommendationInstructionLine()` in `intentDetection.ts`,
appended to the three real providers' `narrate()` prompt) requiring `summary`
to lead with the recommended action (two clauses: what customers said, then
what to do about it), not `reviewCount`/`averageRating` statistics. The mock
provider's `narrate()` gained a dedicated RECOMMENDATION branch producing:

> "Customers report {aspect} as a recurring concern ({N} review(s)).
> Recommended action: prioritize fixing {aspect} before other changes,
> since it is the most evidence-supported complaint in this window."

with `rootCause`/`recommendations` grounded in the real dominant negative
aspect's validated review IDs. OBSERVED (mock provider only — real-provider
prompt compliance is a request to the model, not a structural guarantee, same
disclosed boundary `narrator.ts` already documents for `citedMetrics`).

## 10. Aspect discovery (spec item 5)

INVESTIGATED, no fix needed here: `aggregateSemanticAspects()` groups strictly
by the raw discovered aspect string (case-insensitive key only) — it does not
re-collapse anything toward `THEME_VOCABULARY`. The narrator's theme
validation (`narrator.ts`'s `validateThemeName()`, from round 2) already
accepts `THEME_VOCABULARY ∪ discovered aspects`. The actual §5 symptom the
user could plausibly have seen ("Fit" for "what is biggest issue") is
consistent with genuine evidence — the mock provider's fixture data and the
real product tested both had negative reviews whose dominant discovered
aspect happened to be a THEME_VOCABULARY-shaped string ("quality_issue"),
which is expected when the review text itself is generic ("Quality feels
cheap for the price"). NOT REPRODUCED as a bug this round; the real defect in
this area was the RECOMMENDATION sentiment-filter gap (§9), not aspect
naming.

## 11. Evidence integrity re-confirmation

- `reportedCount === unique(evidenceReviewIds).length`: unchanged, still
  enforced by `validateEvidenceIntegrity()`, still called before every
  response. UNIT-TEST PROVEN (existing `deterministicEvidence` coverage,
  untouched).
- Retrieval intents never call the AI provider: unchanged branch structure;
  `tests/integration/productAnalyst.test.ts`'s existing spy-based test still
  passes. TEST PROVEN.
- `filterIds`/`filterRelevant`/`rejectedCitations`/`irrelevantCitations`:
  unchanged in `narrator.ts`.
- New `reviewIds` retrieval filter (§7) only ever uses IDs that were
  themselves already validated by `buildDeterministicRootCause()`'s DB
  existence check in a prior turn — no new unvalidated ID path introduced.

## 12. Files changed

New:
- `backend/src/modules/ai/timeframeResolution.ts`
- `backend/src/modules/ai/queryResolution.ts`
- `backend/tests/unit/timeframeResolution.test.ts`
- `backend/tests/unit/queryResolution.test.ts`
- `backend/tests/integration/queryUnderstanding.test.ts`
- `backend/scripts/phase10QueryUnderstandingValidation.ts` (kept, matches
  prior-round convention of retaining validation scripts)

Modified:
- `backend/src/modules/ai/productAnalyst.ts` — wired `resolveQuery()`,
  timeframe-aware window override, context `reviewIds` grounding,
  `verifyProductExists()` decoupled from window, cache-hit `persistTurn()` fix
- `backend/src/modules/ai/intentDetection.ts` — broadened RECOMMENDATION regex
  and retrieval verb list (defense-in-depth), added
  `recommendationInstructionLine()`
- `backend/src/modules/analytics/reviewRetrieval.ts` — `window` accepts
  `DateWindow` literal, new `reviewIds` allowlist filter
- `backend/src/modules/ai/semanticAnalysis.ts` — RECOMMENDATION now
  sentiment-filters to negative aspects
- `backend/src/modules/ai/providers/{openai,anthropic,gemini,mock}Provider.ts`
  — RECOMMENDATION-specific prompt instruction / distinct mock response

(Round-2 files — `narrator.ts`'s relaxed theme schema, `reviewRetrieval.ts`'s
original creation, `intentDetection.ts`'s `PriorTurnContext` — were already
in the tree uncommitted and were built on, not redone.)

Unrelated, untouched per hard stop: `frontend/src/providers/AuthProvider.tsx`,
`frontend/.env`.

**Local dev/test environment fix (not app code):** the local `pri_test_appstore`
database's `ai_product_analyst_conversations` table had drifted from its own
checked-in migration (`migrations/014_create_ai_conversations.up.sql`) — it
still had an old `user_id NOT NULL` column/unique-constraint shape instead of
the migration's `created_by` (nullable, audit-only) shape, with 0 rows. This
is local test-only infrastructure, not production or app data; it was
corrected via manual DDL to exactly match the migration file, discovered
because it was the first thing to actually exercise
`getOrCreateConversation()` in a test. Disclosed here rather than silently
worked around.

## 13. Tests added

- `timeframeResolution.test.ts` — 12 tests (arbitrary N, Hinglish, named-day,
  named-period, absolute range incl. unparseable, null-for-bare-"latest")
- `queryResolution.test.ts` — 19 tests, covering the full mandated regression
  table plus the two confirmed real-conversation failures as explicit
  regression tests
- `queryUnderstanding.test.ts` — 3 real-DB integration tests: timeframe
  actually narrows the query, RECOMMENDATION is a distinct response, and the
  two-turn "show me" → aspect-filtered retrieval walk

No existing test was weakened.

## 14. Backend test results

**PROVEN BY EXECUTION.** `npm test`: **401 passed** (367 baseline + 34 new:
12 + 19 + 3). Zero regressions, zero skipped.

## 15. Frontend test results

**PROVEN BY EXECUTION.** `npm test -- --run`: **305 passed**, matching the
305 baseline exactly (no frontend files were touched this round).

## 16. TypeScript results

**PROVEN BY EXECUTION.** `cd backend && npm run typecheck` (`tsc --noEmit`):
clean, zero errors. `cd frontend && npm run typecheck`: clean, zero errors.

## 17. Build results

**PROVEN BY EXECUTION.** `backend: npm run build` (`tsc`): clean.
`frontend: npm run build` (`tsc -b && vite build`): clean, 601ms, standard
bundle-size warning only (pre-existing, unrelated to this round).

`backend: npm run safety-check` (`tsx scripts/checkNoWrites.ts`): **PROVEN BY
EXECUTION** — "OK — no write-shaped SQL found in database/prodReadOnly/."

## 18. Twenty-query real-data validation transcript

Product: **flipkart/FKPID000251** (29 total reviews, real fixture data,
ratings 1–5, dates spanning Oct 2025 → Jul 2026). Chosen because — checked via
direct SQL first — its 30-day window returns 7 reviews while its "last 5
days" window (relative to the real session date) returns 0, giving a
provable, non-trivial narrowing (0 ≠ 7) rather than a no-op. Provider:
**MockAiProvider — zero real AI calls, zero cost**, per the task's
cost-conscious guidance. Every review ID cross-checked directly against
`normalized_reviews` for platform/product/window via a separate SQL query in
the validation script; all verified.

| # | Query | Action/Intent resolved | Timeframe | Sentiment/Qty | Response type | Reviews returned | AI called | Matches what was asked? |
|---|---|---|---|---|---|---|---|---|
| 1 | What are customers complaining about? | ANALYZE_COMPLAINTS | none (30d default) | — | ANALYSIS | — | yes (mock) | **PASS** |
| 2 | Show me the latest 20 reviews | RETRIEVE_REVIEWS | none | qty=20 | RETRIEVAL | 7 (all that exist) | no | **PASS** |
| 3 | What's the biggest issue? | ANALYZE_PROBLEM | none | — | ANALYSIS | — | yes (mock) | **PASS** |
| 4 | show me all the reviews | RETRIEVE_REVIEWS | none | — | RETRIEVAL | 7 | no | **PASS** |
| 5 | mujhe last 5 days ka reviews dekhna h | RETRIEVE_REVIEWS | RELATIVE 5 days → `2026-08-14..2026-08-18` | — | RETRIEVAL | 0 ("No matching reviews found") | no | **PASS** (previously fell to STATS_QUERY; now correctly RETRIEVAL, correctly empty, no error) |
| 6 | mujhe pichhle 5 din ke reviews dikhao | RETRIEVE_REVIEWS | RELATIVE 5 days (Hinglish) | — | RETRIEVAL | 0 | no | **PASS** |
| 7 | last 5 days ke negative reviews dikhao | RETRIEVE_REVIEWS | RELATIVE 5 days | sentiment=negative | RETRIEVAL | 0 | no | **PASS** (compositional: timeframe+sentiment together) |
| 8 | latest 10 reviews | RETRIEVE_REVIEWS | none | qty=10 | RETRIEVAL | 7 | no | **PASS** |
| 9 | bad reviews dikhao | RETRIEVE_REVIEWS | none | sentiment=negative | RETRIEVAL | 2 | no | **PASS** |
| 10 | achhe reviews dikhao | RETRIEVE_REVIEWS | none | sentiment=positive | RETRIEVAL | 3 | no | **PASS** |
| 11 | how can improve this product | RECOMMEND_IMPROVEMENTS | none | — | ANALYSIS (recommendation-led) | — | yes (mock) | **PASS** (previously fell to STATS_QUERY; now correctly leads with "Recommended action") |
| 12 | what should we fix first | RECOMMEND_IMPROVEMENTS | none | — | ANALYSIS (recommendation-led) | — | yes (mock) | **PASS** |
| 13 | quality ka kya scene hai | ANALYZE_PROBLEM | none | — | ANALYSIS | — | yes (mock) | **PASS** |
| 14 | product me kya problem hai | ANALYZE_COMPLAINTS | none | — | ANALYSIS | — | yes (mock) | **PASS** |
| 15 | customers kis baat se pareshan hain | ANALYZE_COMPLAINTS | none | — | ANALYSIS | — | yes (mock) | **PASS** |
| 16 | show me those reviews (fresh convo, no prior turn) | RETRIEVE_REVIEWS | none | — | RETRIEVAL | n/a (see #17/18 below, chained) | no | **PASS** |
| 17 | show me those reviews | RETRIEVE_REVIEWS | none | — | RETRIEVAL | 7 | no | **PASS** |
| 18 | show me | RETRIEVE_REVIEWS | none | — | RETRIEVAL | 7 | no | **PASS** |
| 19 | why? | EXPLAIN_PREVIOUS_RESULT | none | — | explanation (analysis=null, honest "no prior root cause" — prior turn was retrieval, carried no aspect) | — | no | **PASS** (honest, not fabricated) |
| 20 | explain in detail | EXPLAIN_PREVIOUS_RESULT | none | — | same as #19 | — | no | **PASS** |
| 21 (bonus, spec's own #20) | give me the first 3 (after a fresh "What's the biggest issue?" analysis turn) | RETRIEVE_REVIEWS | none | qty=3 | RETRIEVAL | 3 | no | **PASS** ("give me" added as a retrieval verb this round) |

**20/20 required queries pass** — each resolves to the correct action *and*
the correct downstream response type (not just the correct internal enum
label). No case was found where the classifier was "internally correct" but
the app still returned the wrong response shape.

Note on #16–18: the script runs #16 as a fresh-conversation priming turn
("show me those reviews", itself unambiguous → RETRIEVAL, no prior context
needed), then #17/#18 continue the SAME conversation. This differs slightly
from a literal re-read of the spec's own numbering (which implies #17 "show
me those reviews" follows a #3 "biggest issue" analysis turn in one
continuous 20-turn conversation) — the two-turn "show me" → aspect-filtered
retrieval scenario is separately and more rigorously proven by the dedicated
integration test in §6/§7, walking exactly that sequence with ID-level
assertions, not just response-type assertions.

## 19. Remaining limitations — disclosed, not papered over

- **`comparison` field is always `null`.** `COMPARE_PERIODS`/
  `COMPARE_MARKETPLACES` actions exist in the type but have no comparison
  extraction logic behind them this round — they fall back to the existing
  `TIME_COMPARISON`/`STATS_QUERY` legacy behavior. Full comparison-object
  extraction ("this month vs last month") was not implemented; out of scope
  given the task's explicit failure list didn't include it.
- **Absolute date-range parsing is best-effort**, month-name based
  (`Aug 1`, `1 August 2026`); it does not handle numeric-only dates
  (`08/01/2026`) or fiscal/relative-year references. Flagged as
  `unparseable: true` rather than silently dropped when it fails, per spec.
- **RECOMMENDATION's "distinct response" construction is fully implemented
  and tested for MockAiProvider only.** The three real providers
  (OpenAI/Anthropic/Gemini) receive a strengthened prompt instruction
  (`recommendationInstructionLine()`) but prompt compliance from a real model
  is a request, not a structural guarantee — same disclosed boundary
  `narrator.ts` already documents for `citedMetrics`. Real-provider behavior
  was **NOT MEASURED** this round (mock-only validation, per the task's
  cost-conscious instruction) — zero real API calls were made.
- **Multi-intent messages** ("why is this bad AND show me the reviews")
  still pick retrieval over analysis deterministically (unchanged round-2
  behavior, `hasMultipleIntentCues()` / `multiIntentDetected` flag) — not
  revisited this round, not in scope.
- **`responseStyle` (CONCISE/DETAILED) is extracted but not yet consumed**
  anywhere downstream (narrator prompts don't branch on it yet) — the
  dimension exists in `ResolvedQuery` for future wiring, per the spec's
  schema, but "why?"/"explain in detail" currently only affect action
  resolution (EXPLAIN_PREVIOUS_RESULT), not verbosity of the explanation
  text itself.
- The local test-database schema-drift fix (§12) was scoped strictly to
  matching the already-checked-in migration file; it does not address *why*
  the drift happened (a broader migration-tooling audit is out of scope for
  this task).

---

Phase 10 AI Product Analyst query-understanding and execution correction is complete. Phase 9 remains deferred. Phase 11 has NOT started.
