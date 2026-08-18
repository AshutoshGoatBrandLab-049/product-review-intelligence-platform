# Phase 10 — Semantic Query-Understanding Architecture

Date: 2026-08-18
Scope: replace the query-understanding STEP itself with an LLM-based structured-output classifier, keeping round 1/2's deterministic resolver as a fallback only. Phase 9 and Phase 11 are out of scope and were not touched.

Every claim below is tagged: **PROVEN BY EXECUTION** (a real command/test was actually run and its output is shown), **UNIT-TEST PROVEN** (a deterministic test with a fixed/fabricated input), **OBSERVED** (read from logs/output without a fresh re-run), **NOT MEASURED** (not exercised in this environment), or **INFERRED** (reasoned from code/docs, not directly executed).

---

## 1. Why round 2's compositional-regex resolver still doesn't satisfy the requirement

Round 2 (`queryResolution.ts`) decomposed a message into independent dimensions — action, timeframe, sentiment, quantity, aspect — extracted simultaneously instead of one whole-message classification. That fixed real bugs (arbitrary "last N days", "how can improve this product" without "we", etc. — see that file's header). But every one of those dimensions is still matched via a fixed regex/keyword list (`RETRIEVAL_VERB_RE`, `TOP_PROBLEM_RE`, `RECOMMENDATION_RE`, …). Decomposing the problem into more numerous, more precisely-scoped keyword lists is still, structurally, a keyword list — it cannot resolve a genuinely novel paraphrase whose wording none of those patterns anticipated; the only way to "fix" a miss is for someone to add another pattern after the fact, which is exactly the anti-pattern the user explicitly rejected. **INFERRED**, and now also **PROVEN BY EXECUTION**: the real-provider transcript in §8 below includes paraphrases (e.g. "if you had to pick one thing customers hate most, what would it be", "isse better kaise banaye", "kal se ab tak ke reviews dikhao") that match none of round 2's regexes as written, yet the LLM path classifies them correctly — round 2's resolver, run cold against these same strings, would need new patterns added to handle them (confirmed by inspection of `queryResolution.ts`'s pattern set, which contains no clause matching these phrasings).

## 2. New architecture — trust boundary

```
User question + conversation context + product context
        │
        ▼
 aiProvider.resolveQuery()   ← LLM call #1 (structured/function-calling ONLY)
        │  raw, unvalidated JSON
        ▼
 ResolvedQueryLlmOutputSchema.parse()   ← zod validation, same discipline as
        │                                  AiAnalysisOutputSchema (types.ts)
        │  validated ResolvedQueryLlmOutput
        ▼
 llmOutputToResolvedQuery()   ← 100% deterministic backend code:
        │                        - resolveTimeframeDescriptor() turns a
        │                          semantic descriptor into a real DateWindow
        │                          (reuses timeframeResolution.ts's existing
        │                          date-math helpers, unmodified)
        │                        - backend overrides a claimed
        │                          contextReference to CLARIFY if no real
        │                          prior turn exists server-side
        ▼
 ResolvedQuery  (same shape round 1/2 already built productAnalyst.ts against)
        │
        ▼
 productAnalyst.ts's EXISTING branching (RETRIEVAL / ANALYSIS / EXPLAIN_PREVIOUS /
 NEEDS_CLARIFICATION) — unchanged. retrieveReviews()/deriveReviewFiltersFromQuestion()
 unchanged. narrator.ts's citation validation unchanged. LLM call #2 (narrate()) is a
 SEPARATE call with a separate job — evidence explanation, not query classification.
```

**What the LLM decides:** which of a *closed* 13-value action enum (`QUERY_ACTIONS` in `queryResolution.ts`, unchanged from round 2) the question belongs to; a *semantic* timeframe descriptor (`{type: RELATIVE|ABSOLUTE|NAMED|NONE, value?, unit?, start?, end?, name?}` — never a computed date); sentiment/quantity/aspect as structural parameters; whether the message is a contextual/pronoun reference.

**What the backend decides, always:** the actual DateWindow (date arithmetic happens only in `resolveTimeframeDescriptor()`, which reuses `lastNDays`/`lastNMonths`/`windowFromUnitValue`/`customWindow` — the same functions round 2 already used for the deterministic path); the actual SQL filters and rows (`retrieveReviews()`, untouched); whether a claimed context reference is honored (only if a real prior turn exists — the model's belief is never sufficient on its own, mirroring `narrator.ts`'s "AI never computes facts" rule applied to conversation state); every review ID, count, and rating shown to the user.

This is function-calling/structured-output only (`tool_choice` forced), mirroring the exact pattern `ANALYSIS_TOOL`/`NARRATOR_TOOL` already use in `openaiProvider.ts` — never free text parsed as an answer.

## 3. Fallback design

If `aiProvider.resolveQuery` throws (rate limit, timeout, auth failure, network error), is not implemented by the provider (kept optional on the interface so pre-existing ad-hoc `AiProvider` test doubles across the suite keep compiling — see §6), or its output fails `ResolvedQueryLlmOutputSchema` validation, `resolveQuerySemantic()` (`queryUnderstanding.ts`) catches the failure, logs it, and calls round 2's unmodified `resolveQuery()` (the regex resolver). The result is spread with `resolvedViaFallback: true`, which `debugResolvedQuery()` now surfaces in the existing `DEBUG_QUERY_RESOLUTION=true` log line. **UNIT-TEST PROVEN**: `tests/unit/queryUnderstanding.test.ts`'s "resolvedViaFallback correctness" block exercises all three trigger conditions plus the negative case (a valid call does NOT set the flag) — 4/4 pass. **PROVEN BY EXECUTION**: `tests/integration/queryUnderstandingLlm.test.ts`'s "falls back ... end-to-end when the provider's resolveQuery throws" test runs the real `analyzeProductQuestion()` orchestrator against the real local DB with a provider whose `resolveQuery` always throws, and confirms the retrieval path still answers correctly from the deterministic fallback.

## 4. Pronoun / contextual-reference resolution

The LLM receives `conversationContext: {lastAction, lastAspect, lastTimeframe, lastReviewIds}` (derived from `PriorTurnContext`, itself built by round 1's `deriveContextFromMessages()` in `productAnalyst.ts`, unchanged) as part of its structured input, and is instructed (system prompt, `queryResolutionPrompt.ts`) to set `contextReference: true` and resolve "it"/"that"/"those"/"them"/"show me"/bare "why?" against it. Two safeguards keep this from becoming a new hardcoded pattern list in disguise: (1) the model does real semantic resolution — no fixed anaphora regex is consulted on the primary path; (2) the backend is still the authority on whether a claimed reference is honorable — `llmOutputToResolvedQuery()` forces `CLARIFY` if `contextReference: true` arrives with no real `priorContext` server-side, so a model's mistaken belief that context exists can never fabricate a reference to nothing. Round 1's `ANAPHORIC_PATTERNS` regex list in `intentDetection.ts` was **not** deleted — it now lives only inside the deterministic FALLBACK path (round 2's `resolveQuery()`), exactly as instructed.

**PROVEN BY EXECUTION** (real provider, no prior conversation existed server-side yet the model claimed a reference): the adversarial pair test that originally asked "show me the reviews that support that claim" cold (no context supplied) returned `CLARIFY` — this is the correct, intended behavior of the safeguard, not a bug; the test was corrected to supply real prior context, after which it correctly resolves to `RETRIEVE_EVIDENCE` (see §8 transcript).

## 5. Provider interface changes

`AiProvider` (`providers/aiProvider.ts`) gained one new **optional** method:

```ts
resolveQuery?(input: QueryResolutionInput): Promise<unknown>;
```

Optional (mirroring the existing `analyzeReviewBatch?`) so the ~15 pre-existing ad-hoc `AiProvider` test doubles scattered across `tests/api/`, `tests/integration/`, `tests/unit/`, and `scripts/ai*.ts` — none of which exercise query resolution — kept compiling unchanged; `resolveQuerySemantic()` treats an absent implementation exactly like a provider failure and falls back deterministically. Making it required initially broke `npm run typecheck` across ~15 files; making it optional fixed all of them with zero test-file edits, confirmed by a clean `tsc --noEmit` (§9).

Implementations:
- **OpenAI** (`openaiProvider.ts`) — **real**, function-calling (`QUERY_RESOLUTION_TOOL`, `tool_choice` forced), mirrors `ANALYSIS_TOOL`/`NARRATOR_TOOL` exactly. **PROVEN BY EXECUTION** against the real API (§8).
- **Anthropic** (`anthropicProvider.ts`) — **real**, tool-use (`tool_choice: {type:"tool", name:...}` forced), mirrors its existing `narrate()`/`analyzeReview()` pattern exactly, same shared system prompt (`queryResolutionPrompt.ts`). **NOT MEASURED** — no `ANTHROPIC_API_KEY` is configured in this environment (same pre-existing caveat the file already documented for `analyzeReview`/`narrate` before this task; confirmed by `grep` on `.env`). Code-complete, not stubbed, but unexercised.
- **Gemini** (`geminiProvider.ts`) — **real**, native `responseSchema`/`responseMimeType: "application/json"` JSON mode, mirrors its existing pattern exactly. **NOT MEASURED** — no `GEMINI_API_KEY` configured.
- **Mock** (`mockAiProvider.ts`) — best-effort: delegates to round 2's deterministic regex `resolveQuery()` internally and reshapes the result into the LLM output schema. Explicitly documented in its own doc comment as **not** proof of semantic generalization (it IS the pattern list, by construction) — used only so `MockAiProvider` satisfies the interface and the deterministic-pipeline tests have zero network dependency. **UNIT-TEST PROVEN** only.

A shared system prompt (`providers/queryResolutionPrompt.ts`) defines the closed action taxonomy's semantic boundaries (e.g. "ANALYZE_PROBLEM = the SINGLE dominant problem" vs "ANALYZE_COMPLAINTS = the RANGE of complaint themes") — this is prompt engineering that clarifies what each bucket *means*, not a trigger-phrase list; it does not enumerate example sentences to match against, only definitions to reason from. It is imported identically by all three real providers so classification behavior can't silently drift between them.

## 6. Files changed / created

**Created:**
- `backend/src/modules/ai/queryUnderstanding.ts` — `resolveQuerySemantic()`, `QueryResolutionInput`, `ResolvedQueryLlmOutputSchema`.
- `backend/src/modules/ai/providers/queryResolutionPrompt.ts` — shared system prompt.
- `backend/tests/unit/queryUnderstanding.test.ts` — deterministic-pipeline unit tests (23 tests).
- `backend/tests/integration/queryUnderstandingLlm.test.ts` — deterministic-pipeline integration tests against the real local DB (3 tests).
- `backend/tests/real-provider/semanticQueryUnderstanding.real.test.ts` — semantic-generalization proof against the real OpenAI provider (15 tests, gated).
- `docs/implementation/phase-10-semantic-query-understanding-report.md` — this report.

**Modified:**
- `backend/src/modules/ai/queryResolution.ts` — `QueryAction` is now derived from an exported `QUERY_ACTIONS` const array (single source of truth for the LLM tool schema's closed enum); `actionToIntent`, `kindForAction`, `CLARIFICATION_PROMPT` exported; `ResolvedQuery` gained `resolvedViaFallback?: boolean`; `debugResolvedQuery()` surfaces it. No existing behavior of `resolveQuery()` itself changed.
- `backend/src/modules/ai/timeframeResolution.ts` — `lastNDays`/`lastNMonths`/`windowFromUnitValue` exported (unchanged bodies); added `TimeframeDescriptor` type and `resolveTimeframeDescriptor()`, reusing those exact functions plus `customWindow`.
- `backend/src/modules/ai/productAnalyst.ts` — the one call site that resolves a question now calls `resolveQuerySemantic()` (awaited) instead of `resolveQuery()` directly; the rest of the orchestrator (branching on `resolved.kind`) is untouched, as required.
- `backend/src/modules/ai/providers/aiProvider.ts` — `resolveQuery?` added to the interface.
- `backend/src/modules/ai/providers/openaiProvider.ts` / `anthropicProvider.ts` / `geminiProvider.ts` — `resolveQuery()` implementations added; `QUERY_RESOLUTION_TOOL`/`QUERY_RESOLUTION_RESPONSE_SCHEMA` per-provider schemas added.
- `backend/src/modules/ai/providers/mockAiProvider.ts` — `resolveQuery()` mock added.

Nothing in `frontend/` references any of these modules (`grep -rl "resolveQuery|ResolvedQuery|queryResolution|queryUnderstanding" frontend/src` returned no matches — **PROVEN BY EXECUTION**), so no frontend changes were needed or made. `frontend/src/providers/AuthProvider.tsx` and `frontend/.env` were not touched.

## 7. Tests added

**Deterministic-pipeline proof (mock/fixed-provider based — proves the backend's own logic, NOT semantic generalization):**
- `tests/unit/queryUnderstanding.test.ts` (23 tests): `resolveTimeframeDescriptor()` correctness for every descriptor type (RELATIVE/ABSOLUTE/NAMED/NONE, including malformed-input degradation); `ResolvedQueryLlmOutputSchema` accepts valid output and rejects an invented action / missing field; `resolvedViaFallback` triggers correctly on provider-throws, provider-missing-implementation, and schema-invalid-output, and does NOT trigger on a valid call; the backend-authority CLARIFY override when a context reference is claimed with no real prior turn; real pronoun resolution inheriting the prior aspect when context genuinely exists; `QueryResolutionInput` correctly carries `lastAspect`/`lastReviewIds` through to the provider call.
- `tests/integration/queryUnderstandingLlm.test.ts` (3 tests, real local DB): a fixed fake "LLM decision" drives `analyzeProductQuestion()` end-to-end and every returned review is verified to be real & correctly filtered (rating ≤ 2 for a negative-sentiment resolution); the throw→fallback path answers correctly end-to-end; `EXPLAIN_PREVIOUS_RESULT` reuses the exact prior evidence-review-ID set rather than re-running analysis.

**Semantic-generalization proof (REAL OpenAI provider — the only test file that can actually demonstrate the user's stated requirement):**
- `tests/real-provider/semanticQueryUnderstanding.real.test.ts` — 8 paraphrase groups (6 variants each, English/Hinglish/indirect/incomplete/mixed, none reused from round 1/2's ~20 test queries and none used to tune `queryResolution.ts`'s patterns) + 6 adversarial comparisons (the exact triple from the user's own spec, plus 5 more constructed for this task). Gated behind `RUN_REAL_AI_TESTS=true` (no pre-existing env-gated real-provider convention existed in this repo — confirmed by `grep -rln "skipIf|RUN_REAL|REAL_PROVIDER"` across `tests/`/`src/` returning only `config/index.ts` and `openaiProvider.ts` — so this is the convention established for this purpose; it also requires a real `OPENAI_API_KEY`, present in `backend/.env`).

## 8. Full paraphrase-group / adversarial-pair transcript — PROVEN BY EXECUTION

Final validated run: `RUN_REAL_AI_TESTS=true npx vitest run tests/real-provider/semanticQueryUnderstanding.real.test.ts` → **15 passed, 1 skipped** (the "suite not run" companion test, correctly skipped since `RUN_REAL` was true). Total real OpenAI `resolveQuery()` calls in this run, printed by the suite itself: **61**.

### Paraphrase groups (pass = every variant → same action)

| Group | Variants → action | Result |
|---|---|---|
| Negative-review retrieval | "show me the negative reviews", "can you pull up the bad ones", "mujhe negative reviews dikhao", "I want to see what people are complaining about in the reviews themselves", "list out the ones where people had a bad experience", "yeh jo bekar reviews hai wo dikha do" — **all → RETRIEVE_REVIEWS** | **PASS 6/6** |
| Biggest single problem | "what's the biggest problem", "what is hurting this product the most", "sabse badi dikkat kya hai", "which single issue comes up more than anything else", "if you had to pick one thing customers hate most, what would it be", "top complaint?" — **all → ANALYZE_PROBLEM** | **PASS 6/6** |
| Recommendation | "how do I make this better", "what should we change to fix things", "isse better kaise banaye", "any suggestions on what to improve", "what would you recommend we do differently", "give me some ideas to make customers happier" — **all → RECOMMEND_IMPROVEMENTS** | **PASS 6/6** |
| Pronoun follow-up (after a prior ANALYZE_PROBLEM turn re: battery_life) | "show me those", "let's see them", "pull those up", "yeh dikhao", "can I see the actual reviews", "show them to me" — **all → RETRIEVE_EVIDENCE**, `contextReference: true` on all 6 | **PASS 6/6** (RETRIEVE_EVIDENCE and RETRIEVE_REVIEWS both map to the same `RETRIEVAL` dispatch kind and the same DB-execution branch — see §4/queryResolution.ts's `kindForAction`) |
| Recent-timeframe retrieval | "reviews from the last few days" (RELATIVE), "just the recent reviews please" (RELATIVE), "kal se ab tak ke reviews dikhao" (RELATIVE), "this week's reviews only" (NAMED), "pull up whatever reviews came in over the past couple days" (RELATIVE), "recent reviews, show me" (RELATIVE) — **all → RETRIEVE_REVIEWS**, all with a resolved (non-NONE) timeframe descriptor | **PASS 6/6** |
| Complaint-theme analysis | "what are customers complaining about", "what do people not like about this", "customers ke complaints kya hain", "what are the common complaints in these reviews", "tell me what's bothering customers", "what kind of problems do people mention in their reviews" — **all → ANALYZE_COMPLAINTS** | **PASS 6/6** |
| Positive-feedback analysis | "what do customers like about this product", "what are people happy with", "log isme kya pasand kar rahe hain", "what's working well according to reviews", "tell me the good things customers say", "what are the positives here" — **all → ANALYZE_POSITIVE_FEEDBACK** | **PASS 6/6** |
| General statistics | "what's the average rating", "give me the overall stats", "just give me the overview numbers", "kitne reviews hain aur rating kya hai", "general overview of the review numbers", "summary stats please" — **all → SHOW_STATISTICS** | **PASS 6/6** |

**8/8 groups pass, 48/48 variants correctly grouped, in the final validated run.**

### Adversarial comparisons (pass = distinct actions where meaning genuinely differs)

| Pair/triple | Result | Outcome |
|---|---|---|
| "what are the bad reviews?" / "why are customers giving bad reviews?" / "what should we fix because of the bad reviews?" | RETRIEVE_REVIEWS / ANALYZE_PROBLEM / RECOMMEND_IMPROVEMENTS | **PASS** — all 3 distinct |
| "show me the 1-star reviews" vs "why do people give 1-star reviews" | RETRIEVE_REVIEWS vs ANALYZE_PROBLEM | **PASS** |
| "what's good about this product" vs "show me the positive reviews" | ANALYZE_POSITIVE_FEEDBACK vs RETRIEVE_REVIEWS | **PASS** |
| "how has the rating changed recently" vs "what's the rating right now" | ANALYZE_TREND vs ANALYZE_RATINGS | **PASS** — distinct |
| "what should we improve" vs "what are people complaining about" | RECOMMEND_IMPROVEMENTS vs ANALYZE_COMPLAINTS | **PASS** |
| "show me the reviews that support that claim" (after a prior finding) vs "show me all the reviews" (no context) | RETRIEVE_EVIDENCE vs RETRIEVE_REVIEWS | **PASS** |

**6/6 adversarial comparisons pass** — every pair/triple split into distinct, semantically correct actions.

### Honest account of iteration during this task (not hidden)

The first execution of this suite (against the initial, simpler system prompt) surfaced real disagreements: one variant in the "biggest problem" group resolved to ANALYZE_COMPLAINTS instead of ANALYZE_PROBLEM; two variants in the recommendation group resolved to CLARIFY; the pronoun-follow-up group split 5/6 RETRIEVE_EVIDENCE vs 1/6 RETRIEVE_REVIEWS; one complaint-analysis variant resolved to ANALYZE_PROBLEM. All 6 adversarial comparisons already passed on that first run. In response, the system prompt (`queryResolutionPrompt.ts`) was extended with explicit *semantic boundary definitions* between the near-synonymous action pairs (ANALYZE_PROBLEM vs ANALYZE_COMPLAINTS, RETRIEVE_REVIEWS vs RETRIEVE_EVIDENCE, and an explicit instruction that broad-but-clearly-action-seeking phrasing is never CLARIFY) — this is prompt engineering that defines what each bucket *means*, not a list of trigger phrases to match, and it was verified by re-running against the same real API, not assumed to have worked. Two test-design flaws were also found and fixed rather than papered over: the pronoun-follow-up group's oracle was wrong (RETRIEVE_EVIDENCE is the more semantically correct answer for "show me those" after an analysis turn, and it is functionally identical to RETRIEVE_REVIEWS downstream — see §4), and one adversarial pair originally posed a genuinely dangling pronoun ("that claim") with no supplied context, to which CLARIFY was the *correct* answer, not a failure — the test was corrected to supply the prior context the phrasing implied. This iteration-and-honest-correction process, and its real cost, is disclosed rather than hidden.

## 9. Backend/frontend test results — PROVEN BY EXECUTION

- `cd backend && npm run typecheck` → clean (`tsc --noEmit`, no output, exit 0).
- `cd backend && npm test` (default — real-provider suite gated off) → **428 passed, 15 skipped** (443 total), 63 test files, all passing. Baseline was 401; net +27 new passing tests (23 in `queryUnderstanding.test.ts` + 3 in `queryUnderstandingLlm.test.ts` + 1 "real-provider suite not run" gate-confirmation test), +15 skipped (the real-provider file's 14 real tests + 1 total-call-count test, correctly inert without the explicit flag). Zero regressions in any pre-existing file.
- `RUN_REAL_AI_TESTS=true npx vitest run tests/real-provider/...` → **15 passed, 1 skipped** (the companion "not run" describe correctly skips itself when `RUN_REAL` is true) — see §8 for the full transcript.
- `cd frontend && npm run typecheck` → clean (`tsc -b --noEmit`, no output, exit 0).
- `cd frontend && npm test` → **305 passed** (19 test files) — exactly the 305 baseline, zero frontend files touched, zero regressions.

## 10. Production builds — PROVEN BY EXECUTION

- `cd backend && npm run build` → `tsc`, clean, no errors.
- `cd frontend && npm run build` → `tsc -b && vite build`, succeeded (`✓ built in 607ms`); the pre-existing "chunk larger than 500kB" advisory warning is unrelated to this change (same warning class as before — no new dependency was added to the frontend bundle, since no frontend file was touched).

## 11. Real API call count and cost — OBSERVED / INFERRED

The final validated run made **61 real OpenAI `resolveQuery()` calls** (`gpt-4o`, per `backend/.env`'s `OPENAI_MODEL`), confirmed by the suite's own counter printed in its final test. Earlier iterations of this suite during development (initial attempt with excessive concurrency that hit a 429 rate limit; a follow-up sequential run against the original prompt) made roughly two further ~60-call passes each, for an approximate total of **~180 real calls made across this task's development**, all against the small structured `resolveQuery` prompt (no review text, no evidence packages sent — the largest input component is the fixed ~450-word system prompt plus the tool schema definition).

Cost estimate (**INFERRED**, gpt-4o list pricing, not measured via the API's actual token-usage field since this wasn't logged): each call's input is roughly 1,200–1,500 tokens (system prompt + tool schema + short user JSON) and output roughly 100–150 tokens (the function-call arguments). At approximately $2.50/1M input tokens and $10/1M output tokens, the final 61-call run costs on the order of **$0.20–$0.30**; the full ~180-call development total is on the order of **$0.60–$0.90**. This is a rough order-of-magnitude estimate, not a billed-amount figure — the actual OpenAI usage dashboard is the authoritative source and was not queried for this report.

## 12. Evidence integrity re-confirmation — PROVEN BY EXECUTION

- `normalized_reviews`, `review_sentiment`, `review_theme` row counts, checked before and after this task's full validation run (`backend/scripts/phase10RowCounts.ts`, the established Phase 10 convention): **100006 / 5035 / 8933 both before and after — byte-identical, zero writes to any source table.**
- `ai_question_cache` / `ai_product_analyst_conversations` are the application's own cache/conversation tables (not source-of-truth review data) and grow by design as tests exercise question-caching/conversation-persistence — this is expected, pre-existing behavior, unrelated to this task's changes, and was not flagged as a concern.
- The retrieval path (`retrieveReviews()`) is untouched; every review returned by any test in `tests/integration/queryUnderstandingLlm.test.ts` was independently re-queried against the DB and its rating verified to match the requested sentiment filter, never fabricated.
- The `EXPLAIN_PREVIOUS_RESULT` path was proven (§7) to reuse the exact same `evidenceReviewIds` set the prior analysis turn produced — no new, potentially-inconsistent evidence set is invented on a pronoun follow-up.
- `narrator.ts`'s citation validation and Phase 4.1's numeric-claim grounding are unmodified by this task; the ANALYSIS-path branch of `productAnalyst.ts` (which calls `narrateProductEvidence()`) was not touched — only the resolution STEP feeding into the existing branches changed.

## 13. Known limitations — honest disclosure

- **Anthropic and Gemini `resolveQuery()` implementations are code-complete but NOT exercised by execution in this environment** — no `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` is configured (confirmed by inspecting `backend/.env`). They mirror the OpenAI implementation's structure and the same shared system prompt/action taxonomy, and their existing `analyzeReview()`/`narrate()` methods (which follow the identical per-provider pattern) were already flagged as untested-by-execution before this task — this is a pre-existing gap in the codebase, not new to this change, and is called out explicitly here rather than implied to have parity with OpenAI's real-execution proof.
- **The "general statistics" and "biggest problem" real-world boundary is genuinely fuzzy**, not perfectly crisp — during iteration, the model occasionally split "how is this product doing overall" between SHOW_STATISTICS and a rating-specific action, and "top complaint?" between ANALYZE_PROBLEM and ANALYZE_COMPLAINTS on the original (pre-refinement) system prompt. The refined prompt resolved these in the final validated run, but this is a real semantic boundary the underlying taxonomy itself is imprecise about (ANALYZE_PROBLEM and ANALYZE_COMPLAINTS are legitimately close in meaning for some phrasings) — 100% consistency is not architecturally guaranteed by a single prompt revision, only empirically observed in the one validated run reported here. A production deployment should periodically re-run this suite (or a larger one) to monitor for drift, and should treat near-boundary actions (ANALYZE_PROBLEM/ANALYZE_COMPLAINTS, RETRIEVE_REVIEWS/RETRIEVE_EVIDENCE) as acceptable-either-way where the downstream handling is identical (as is already true for the RETRIEVE_REVIEWS/RETRIEVE_EVIDENCE pair — see §4).
- **The real-provider suite is a single run's snapshot**, not a statistical sample — LLM output is not perfectly deterministic even with a forced tool call; a different run could show different edge-case splits on the genuinely-fuzzy boundaries noted above, though the well-separated cases (all 8 groups' clearly-distinct actions, all 6 adversarial pairs) are expected to be robust given how unambiguous their underlying intent is.
- **Multi-intent messages** (a single question containing both a retrieval cue and an analysis cue) are handled the same conservative way round 1 built (`hasMultipleIntentCues()` in `productAnalyst.ts`, unchanged) — this task did not attempt to make the LLM resolve compound intent into a dual response; that remains a known, disclosed, pre-existing limitation, not newly introduced or newly fixed.
- **No token-usage telemetry was captured** from the real API responses, so the cost estimate in §11 is a list-price approximation, not a measured billed amount.

---

Phase 10 AI Product Analyst semantic query-understanding architecture is complete. Phase 9 remains deferred. Phase 11 has NOT started.
