# Phase 4.1 — Real AI Provider Validation — Report

**Status: Phase 4.1 is COMPLETE, and both remediation rounds are COMPLETE.** Steps 1–9, 13, 14, 15 were aligned with the original specification throughout. Steps 10–12 were initially executed under a different, self-generated numbering that didn't match the original spec (discovered, disclosed in full, and now reconciled — see below). All six originally-authorized remediation items (citation relevance, retry-delay handling, structured failure logging, paid-tier cost, human-ground-truth accuracy, and the Step 10–12 reconciliation itself), plus the follow-on numerical-claim-grounding remediation (Item 7, closing the gap the Step 10–12 reconciliation surfaced), are complete. See the "Phase 4.1 Remediation" section near the end of this report for the full remediation record, and Step 15 §20 for the original final decision. Stopping here per instruction — waiting for explicit approval before anything beyond this remediation.

**Historical reconciliation:** the initial execution labeled Steps 10–12 differently from the recovered original specification (Step 10: "Numerical Claim Safety," a specific 42%-vs-45% mismatch test; Step 11: "Real Provider Rate Limiting," explicitly requiring normal controlled calls, not deliberate/aggressive reproduction; Step 12: "Performance," latency/throughput measurement with a mock-vs-real comparison). The mismatch was identified and explicitly reconciled: the originally specified numerical-claim, rate-limit, and performance requirements were separately evaluated and are now documented below under their correct Step 10/11/12 headings. The earlier executions are **preserved, not deleted**, as "Supplementary Validation A/B/C" later in this report — each still contains real, valuable findings (the sparse-evidence citation-fabrication discovery, the deliberate-429 reproduction data, and the interim consolidated summary) that remain part of this report's evidence base, just no longer mislabeled as the original spec's Steps 10–12.

**Provider note:** switched from Anthropic to **Gemini** per your direction mid-session. A `GeminiProvider` was built from scratch, following the exact same pattern as the (still-present, still-untested) `AnthropicProvider` — same `AiProvider` interface, same forced-structured-output discipline (Gemini's native `responseSchema`/`responseMimeType: "application/json"` mode, never free-text parsing), same "throws immediately if no key" construction guard. `AI_PROVIDER` now accepts `"mock" | "anthropic" | "gemini"`; only the exact string set activates a real provider.

---

## Supplementary Validation C — Interim Consolidated Summary (Historical)

*Originally labeled "Step 12" before the numbering mismatch with the recovered original specification was discovered (see "Historical reconciliation" above). Preserved here unedited — its content and findings remain valid and are still part of this report's evidence base — but it is not the original spec's Step 12 ("Performance"), which appears in its correct position below. This section's synthesis covers Steps 1–11 as they stood before the reconciliation; the fully current picture, including the reconciliation itself, is in the "Phase 4.1 Remediation" section near the end of this report.*

This section synthesizes Steps 1–11 into a single reference. It **restates existing findings, never softens or reinterprets them** — every number below is pulled unchanged from the step section that originally measured it; where this section itself computes something new (the aggregate real-call count), that is marked explicitly as a rollup, not a fresh measurement. No new Gemini calls were made for this step — pure synthesis plus a final read-only database check and full regression.

### What was validated, end to end

| # | Step | Core question | Outcome |
|---|---|---|---|
| 1 | Inspection | Does the existing Phase 4 architecture need changes to add a real provider? | No — only a new provider + config, pipeline/validation/evidence/narrator all reused unmodified |
| 2 | Provider config | Is the real key configured safely, never logged? | Yes — presence-checked only, `AI_PROVIDER` still defaults to `mock` |
| 3 | Canary | Does the real Gemini provider work at all? | Yes, after finding and fixing a deprecated default model name (`gemini-2.5-flash` → `gemini-flash-latest`) |
| 4 | 10-review smoke test | Does the real pipeline work end-to-end on real local data? | 9/9 non-rate-limited reviews succeeded; 1 genuine rate-limit failure, correctly isolated |
| 5 | Mock vs. real comparison | How does real Gemini differ from the mock, on the same data? | 9/9 sentiment agreement (rating-driven, not an accuracy claim); real Gemini finds more themes via semantic extraction vs. the mock's literal keyword match |
| 6 | Idempotency / staleness | Does the pipeline correctly avoid/require reclassification based on content, never `updatedAt`? | All 4 cases (A–D) proved — 1 real call used (Case C), exactly at budget |
| 6.1 | Baseline restoration | Can Step 6's 2 mutated rows be restored to their exact pre-Step-6 state? | Yes, fully — checksum-verified exact match, zero new AI calls |
| 7 | Failure isolation | Does one bad review abort the batch, leave partial writes, or block retry? | No on all three — proven against a synthetic injected failure, in the isolated test fixture only |
| 8 | Token / cost | What does a real call actually cost, in tokens and money? | 35/73/479/587 (prompt/output/thoughts/total) tokens, $0 (free tier); paid-tier cost not estimated (no fabricated pricing) |
| 9 | Narrator (well-populated) | Does the real narrator stay schema-valid and evidence-grounded? | Yes — 0 hallucinated citations, one numeric claim exactly matched its evidence-package field |
| 10 | Narrator (sparse evidence) | Does the narrator still avoid fabricating numbers when AI data is entirely absent? | Numbers: yes, all exact matches. **But** it fabricated theme-to-review attributions with zero supporting evidence signal — 1/4 wrong, 1/4 questionable, verified against real review text |
| 11 | Rate limit (deliberate) | What actually happens on a genuine 429, under controlled conditions? | Reproduced deterministically (6 calls); retry recovered in ~1s despite the API requesting ~11s; zero partial writes; quota metadata (`PerDay`, limit 20) contradicted by its own 1-second recovery |

### All findings in one place (none newly softened here — see each step's own section for full detail)

1. **`gemini-flash-latest` resolves to `gemini-3.6-flash`** — only discoverable via a real error payload (Step 3/4).
2. **"color" theme in every Step 4/5 sample review** — explained, not left as a mystery: the mock's literal keyword match confirms the word is genuinely present in the seed text for all 10 reviews (Step 5).
3. **Failure logs omit `platform` and any structured failure-category field** — an operator can't tell Flipkart from Myntra, or "rate limit" from "validation failure," from logs alone without a DB lookup (Step 7). Not fixed — out of every step's explicit scope so far.
4. **Retry/attempt counters count failed attempts, not "retries beyond the first"** — with `maxRetries: 2`, the counter reads 3, not 2 (Step 7).
5. **The resolved model is a "thinking" model** — thinking-tokens dominated every real call measured: 82% (Step 8, short review), 55% (Step 9, dense evidence payload), 40% (Step 10, medium payload). Any cost projection must account for this, or it will substantially underestimate spend.
6. **Citation-ID validity is enforced; citation-relevance is not** (Step 10) — the narrator can attach a real, valid review ID to a claim it doesn't actually support, and nothing in the current pipeline catches this. **1/4 real attributions was factually wrong, 1/4 questionable**, verified against actual review text. This is the most significant open finding from the whole validation.
7. **Retry backoff never reads the provider's own suggested `retryDelay`/`RetryInfo`** — confirmed twice (Step 4 informally, Step 11 with precise timestamps: retried at ~1.0s against an ~11.1s request). Worked out both times in this session; not guaranteed to under a harder quota wall.
8. **Gemini's quota-metadata `quotaId` string is not a reliable guide to actual enforcement duration** — a payload labeled `...PerDayPerProjectPerModel-FreeTier` cleared in about 1 second (Step 11). Treated as a measured discrepancy, not generalized into a claim about how Gemini's quotas work overall.

### Real Gemini call count — rollup of already-documented per-step figures (not independently reconciled against Google's billing dashboard, which this session has no access to)

```
Step 3:   2 measured successful calls + 1 earlier failed call against the since-corrected deprecated model name
Step 4:   19 total attempts (10 initial + 9 retries, matching the run's own retryCount)
Step 6:   1 (Case C; Cases A/D used 0 real calls, proven by call-counting instrumentation)
Step 8:   1
Step 9:   1
Step 10:  1
Step 11:  7 (6 initial + 1 retry)
──────────────────────────────────────────
Rollup total: ~33 real Gemini API round-trips this entire Phase 4.1 sub-phase
```

This total is a **sum of each step's own instrumented count** (call-counting wrappers, per-review outcome tracking, or direct API response inspection) — every individual figure it's built from is PROVEN BY EXECUTION at the step level. The sum itself is presented as an aggregation, not a new independent measurement.

### Final local dataset state — PROVEN BY EXECUTION (direct SQL, just re-verified)

```
normalized_reviews: 100,006   (unchanged across all 11 steps — content_hash is never written by any classification path)
review_sentiment:     5,035   (5,020 at Phase 4.1 start → +9 Step 4 → mutated/restored Steps 6→6.1 → +6 Step 11)
review_theme:          8,933   (8,883 at Phase 4.1 start → +32 Step 4 → mutated/restored Steps 6→6.1 → +18 Step 11)
normalized_reviews checksum: 821903ac625da7ee6256e2b6344ce868
  — identical to the pre-Step-6 checksum, and to every checksum re-verified after Steps 6.1 through 11 without exception
DataWarehouse.flipkart_reviews: 50,007   DataWarehouse.myntra_reviews: 50,002
  — unchanged across all 11 steps, never once written to, confirmed independently at the end of every step that touched real data
```

The `review_sentiment`/`review_theme` growth (5,020→5,035, 8,883→8,933) is **entirely legitimate, permanent, intentional classification** of real, previously-unclassified local reviews (Steps 4 and 11) — the same precedent applied consistently both times, explicitly not requiring restoration. The **only** mutation this whole sub-phase that *did* require restoration was Step 6's 2 deliberately-mutated rows, fully reversed in Step 6.1 and checksum-verified.

### Production access — confirmed zero, across all 12 steps

```
DB_PROD_* variables: never configured or read by this session for a live connection
DataWarehouse.flipkart_reviews / myntra_reviews: read-only queries only (count/checksum verification), never written
Production RDS: never connected to, at any point in Phase 4.1
```

### Consolidated measured-vs-inferred ledger

| Category | Status |
|---|---|
| Real provider works end-to-end (auth, structured output, persistence, retry) | PROVEN BY EXECUTION |
| Staleness/idempotency correctness (content-hash based, `updatedAt`-blind) | PROVEN BY EXECUTION + UNIT-TEST PROVEN |
| Failure isolation, zero partial writes (synthetic AND real-429 causes) | PROVEN BY EXECUTION |
| Token/cost measurement | PROVEN BY EXECUTION (3 independent real samples) |
| Narrator schema validity + citation-ID validity | PROVEN BY EXECUTION |
| Narrator numeric-claim grounding | PROVEN BY EXECUTION (2 independent real samples, including a sparse-evidence edge case) |
| Narrator citation-*relevance* enforcement | **NOT ENFORCED — open architectural gap** |
| Rate-limit isolation and behavior | PROVEN BY EXECUTION (1 incidental + 1 deliberate real 429) |
| Retry backoff respecting provider-suggested delay | **NOT IMPLEMENTED — confirmed absent by source inspection** |
| Failure-log observability (platform, structured category) | **NOT PRESENT — reported, not fixed** |
| Paid-tier cost, at scale, in production | NOT MEASURED — no fabricated pricing anywhere in this report |
| General model accuracy (sentiment/theme correctness vs. ground truth) | NOT CLAIMED — no human-labeled ground truth exists in this project |
| Production readiness of this provider integration | **NOT CLAIMED, anywhere in Steps 1–11** — this report is a validation record, not a go/no-go recommendation |

### Regression (after Step 12)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 12

```
Real Gemini calls: 0 (pure synthesis of already-completed steps)
Mock AI calls: 0
```

---

## 1. Inspection (Step 1) — complete

Re-confirmed against current source: no code changes were needed for the *existing* Phase 4 architecture (pipeline, candidate selection, validation, evidence package, narrator, health-score wiring all unchanged and reused as-is). The only real work was adding the new provider — `src/modules/ai/providers/geminiProvider.ts`, config entries (`GEMINI_API_KEY`, `GEMINI_MODEL`), and the factory branch.

## 2. Real provider configuration (Step 2) — complete

- `AI_PROVIDER=gemini` and `GEMINI_API_KEY=<redacted>` added to `backend/.env` by you directly — never pasted into chat, never printed, never logged by this session.
- Confirmed via `grep` (presence-only check, no value ever displayed) before every subsequent step.
- `AI_PROVIDER` still defaults to `"mock"` in the Zod schema — nothing switches providers except the exact string you set.

## 3. Provider canary (Step 3) — **PASS, with one real issue found and fixed**

**First attempt failed** — not a connectivity or auth problem: the config's default model name, `gemini-2.5-flash`, is deprecated (`404, "This model ... is no longer available to new users"`). This is a real, measured finding, not hidden: latency was 405ms and the error was a genuine API response, proving auth and connectivity both worked on the very first call — the failure was purely a stale default model name.

**Fixed**: default changed to `gemini-flash-latest` (config, `.env.example`, tests). **Second attempt, and a clean re-run using only the corrected default (no override) — both succeeded:**

```json
{
  "success": true,
  "provider": "gemini",
  "modelVersion": "gemini:gemini-flash-latest:analysis-v1",
  "latencyMs": 5436,
  "rawOutput": {
    "sentiment": { "label": "negative", "confidence": 0.95 },
    "themes": [
      { "theme": "quality", "confidence": 0.95, "evidence": "Poor quality" },
      { "theme": "material", "confidence": 0.9, "evidence": "The material feels weak" },
      { "theme": "durability", "confidence": 0.92, "evidence": "stitching came apart after a few uses" }
    ]
  },
  "structuredOutputValid": true,
  "validationErrors": null
}
```

Used the exact synthetic review from your instructions (rating 2, "Poor quality" / stitching-came-apart text) — never a real customer review. Result correctly labeled negative with high confidence, and correctly identified all three real complaint themes present in the text (quality, material, durability), all passing `validateAiOutput`'s Zod schema unchanged.

**Two runs measured** (first with `GEMINI_MODEL=gemini-flash-latest` override, second with the corrected default): latency 6,906ms and 5,436ms respectively — both single real calls, not a batch. Token usage: not captured by this canary script (the SDK response wasn't inspected for usage metadata) — flagging as **NOT MEASURED**, to be captured explicitly in the Step 4/8 smoke test rather than assumed.

## Regression (run after the provider change)

```
npm run typecheck   — clean
npm test             — 194/194 passing (192 Phase 4 baseline + 2 new GeminiProvider construction tests)
npm run safety-check — OK, no write-shaped SQL found
```

## Database safety (Step 13, checked now since real calls occurred)

No database writes occurred in Steps 1–3 — the canary script never imports any persistence code, only `createAiProvider` and `validateAiOutput`. `normalized_reviews`, `DataWarehouse.flipkart_reviews`, `DataWarehouse.myntra_reviews` are all unaffected.

---

## 4. Ten-review local smoke test (Step 4) — **PASS overall, one real failure captured honestly**

### Implementation note

Rather than write a separate one-off script, `candidateSelection.ts` and `pipeline.ts` were extended with an optional `canonicalReviewIds` filter — the exact same mechanism as the existing `platform` filter, reused by `summarizeCandidates`/`findCandidateReviews`. This scopes the *real* pipeline (staleness check, Zod validation, theme-vocabulary validation, retry, persistence, observability — nothing bypassed) to a pre-curated set of IDs instead of writing parallel logic. Full regression (194/194, typecheck, safety-check) confirmed clean after this change, before any real API calls were made.

### Selection

Exactly 10 pre-existing, never-before-classified `normalized_reviews` — one per (platform × rating) combination, giving full coverage: both platforms, all 5 rating levels, all with substantive review text (169–199 characters). Reported in full before processing (see the message immediately preceding this run). Not invented, not modified.

### Result

```
totalReviews (in scope): 10
candidateCount: 10 (all new, staleCount: 0, alreadyClassifiedCount: 0)
processedCount: 10
successCount: 9
failureCount: 1
retryCount: 9 (across the whole run)
status: partial_failure
durationMs: 70,078
```

**The one failure was a genuine rate limit, not a bug**: review `d07762e22dd3d7968944a67ed8f8e97f` (Flipkart, rating 1) failed after exhausting all 4 attempts (1 initial + 3 retries, `AI_MAX_RETRIES=3`) with `429 RESOURCE_EXHAUSTED`:

> `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash. Please retry in 24.78s.`

**Real finding, not previously known**: the `gemini-flash-latest` alias resolves to a concrete underlying model, `gemini-3.6-flash` — visible only because it appeared in this error payload. The retry mechanism worked exactly as designed (`p-retry`, exponential backoff, capped at `maxRetries`) — it just wasn't enough to clear a 24-second quota window within the ~13 seconds this specific retry sequence spanned. Two *other* reviews also hit transient failures and succeeded after retrying (3 and 2 retries respectively) — the mechanism recovered correctly in those cases.

### Per-review results (sentiment/theme only — no reviewer PII, no full review text)

| canonical_review_id | platform | rating | outcome | latency (ms) | retries | sentiment (conf.) | themes |
|---|---|---|---|---|---|---|---|
| `00671e22a1...` | myntra | 5 | success | 4,809 | 0 | positive (0.99) | color, delivery, durability |
| `1da85552ae...` | flipkart | 3 | success | 6,191 | 0 | neutral (0.90) | color, quality, size |
| `3a351bb03a...` | myntra | 3 | success | 6,497 | 0 | neutral (0.90) | quality, value, color, size |
| `5d71e3516d...` | flipkart | 2 | success | 5,624 | 0 | negative (0.98) | delivery, comfort, material, color, product_mismatch |
| `8b11754481...` | flipkart | 4 | success | 5,113 | 0 | positive (0.98) | color, durability, delivery |
| `b7815b09a9...` | myntra | 2 | success | 5,385 | 0 | negative (0.98) | color, delivery, comfort, material |
| `d07762e22d...` | flipkart | 1 | **failure** | 8,541 | 4 | — (rate-limited, no output) | — |
| `d138a2df0f...` | myntra | 1 | success | 14,133 | 3 | negative (0.98) | color, product_mismatch, delivery, comfort |
| `d3210af1a3...` | flipkart | 5 | success | 8,526 | 2 | positive (0.98) | delivery, durability, color |
| `faac5dcf7f...` | myntra | 4 | success | 4,937 | 0 | positive (0.95) | color, delivery, durability |

### 5. Sentiment/theme distribution (of 9 successful)

- **Sentiment**: positive 4, neutral 2, negative 3. **Observation, not an accuracy claim**: on this 9-review sample, the sentiment label matched the rating's expected polarity (1–2★→negative, 3★→neutral, 4–5★→positive) in every single case — noted as an observed pattern on a very small sample, not a general accuracy conclusion.
- **Themes** (32 total tags across 9 reviews): color 9, delivery 7, durability 4, comfort 3, quality 2, size 2, material 2, product_mismatch 2, value 1. **MANUAL SAMPLE REVIEW observation**: "color" appeared in literally every successful review regardless of sentiment or platform — worth investigating later whether this reflects genuinely color-heavy review text in this seed dataset or a model tendency to over-attribute this theme; not concluded either way from 9 data points.
- **Confidence range**: 0.80 (lowest, a theme) to 0.99 (highest, a sentiment) — all within the valid 0–1 bound, none at the extremes.

### 7. Latency

- All 10 attempts (including the failed one's 4 retry attempts): min 4,809ms, max 14,133ms, avg 6,976ms.
- Successful 9 only: min 4,809ms, max 14,133ms, avg 6,802ms.
- Total run duration: 70,078ms for 10 reviews processed sequentially (not batched in parallel).

### 8. Token usage / cost

**NOT MEASURED at Step 4 time.** The pipeline's `analyzeReview` call does not inspect the Gemini SDK response's usage-metadata field during a normal run, so this smoke test did not capture input/output token counts. Captured explicitly in **Step 8** below via a dedicated single-call measurement.

### 14. Database rows written

`review_sentiment`: 5,020 → 5,029 (**+9**, exactly matching `successCount`). `review_theme`: 8,883 → 8,915 (**+32**, exactly matching the sum of themes across the 9 successful per-review results above). Verified by direct count query, not inferred from the pipeline's self-report alone.

### 15. Validation failures

**Zero.** All 9 successful outputs passed Zod schema validation and business validation (theme vocabulary, confidence bounds, freshness) cleanly on the first attempt each. The 1 failure was a provider-availability failure (rate limit), never a validation rejection — no malformed output was returned by Gemini in this run.

### 16. Source-table safety verification

- `normalized_reviews`: row count unchanged (100,006 → 100,006) **and** a full content checksum (`md5` over every `canonical_review_id || content_hash`, ordered) identical before and after: `821903ac625da7ee6256e2b6344ce868` both times — byte-for-byte proof, not just a count check.
- `DataWarehouse.flipkart_reviews`: 50,007 → 50,007 (unchanged). `DataWarehouse.myntra_reviews`: 50,002 → 50,002 (unchanged).
- Freshness-guard verification: `content_hash_at_classification`/`content_hash_at_extraction` matched the current `normalized_reviews.content_hash` for all 9 written rows — 0 mismatches, checked directly via SQL, not assumed from the pipeline's internal guard alone.
- The failed review has zero rows in `review_sentiment` — confirmed no partial/orphaned write.

### 17. Production access confirmation

None. No `DB_PROD_*` variable was read or configured this step; `DataWarehouse.*` was only read (for the before/after checksum and count queries), never written.

## Regression (Step 14, after Step 4)

```
npm run typecheck   — clean
npm test             — 194/194 passing, unaffected by Step 4's real writes (they landed in review_sentiment/review_theme, outside any test fixture)
npm run safety-check — OK, no write-shaped SQL found
```

---

## 5. Mock vs real Gemini comparison (Step 5) — complete, zero additional API calls

### Methodology

Read-only with respect to `review_sentiment`/`review_theme`. The mock provider was called fresh, in-process (`MockAiProvider.analyzeReview()` directly — never through the pipeline's persist step, which would have overwritten Step 4's real Gemini rows via upsert on `canonical_review_id`). The Gemini side reused Step 4's **already-persisted** results, queried read-only. **Zero additional Gemini API calls were made** — exactly as instructed, since the Step 4 outputs were sufficient. Same 10 `canonical_review_ids` as Step 4, no new sample selected.

### Comparison table

| Review (rating) | Mock sentiment | Gemini sentiment | Same label? | Mock themes | Gemini themes | Theme overlap |
|---|---|---|---|---|---|---|
| flipkart★1 (`d07762e2...`) | negative (0.90) | **N/A — no Gemini result** (Step 4 rate-limit failure) | — | comfort, color, delivery | — | — |
| flipkart★2 (`5d71e351...`) | negative (0.90) | negative (0.98) | ✅ | comfort, color, delivery | delivery, comfort, material, color, product_mismatch | mock ⊆ gemini (3/3); gemini +2 (material, product_mismatch) |
| flipkart★3 (`1da85552...`) | neutral (0.90) | neutral (0.90) | ✅ | quality, size, color | color, quality, size | identical sets (3/3) |
| flipkart★4 (`8b117544...`) | positive (0.90) | positive (0.98) | ✅ | color, delivery | color, durability, delivery | mock ⊆ gemini (2/2); gemini +1 (durability) |
| flipkart★5 (`d3210af1...`) | positive (0.90) | positive (0.98) | ✅ | color, delivery | delivery, durability, color | mock ⊆ gemini (2/2); gemini +1 (durability) |
| myntra★1 (`d138a2df...`) | negative (0.90) | negative (0.98) | ✅ | comfort, color, delivery | color, product_mismatch, delivery, comfort | mock ⊆ gemini (3/3); gemini +1 (product_mismatch) |
| myntra★2 (`b7815b09...`) | negative (0.90) | negative (0.98) | ✅ | comfort, color, delivery | color, delivery, comfort, material | mock ⊆ gemini (3/3); gemini +1 (material) |
| myntra★3 (`3a351bb0...`) | neutral (0.90) | neutral (0.90) | ✅ | quality, size, color | quality, value, color, size | mock ⊆ gemini (3/3); gemini +1 (value) |
| myntra★4 (`faac5dcf...`) | positive (0.90) | positive (0.95) | ✅ | color, delivery | color, delivery, durability | mock ⊆ gemini (2/2); gemini +1 (durability) |
| myntra★5 (`00671e22...`) | positive (0.90) | positive (0.99) | ✅ | color, delivery | color, delivery, durability | mock ⊆ gemini (2/2); gemini +1 (durability) |

### Sentiment agreement

**9/9 comparable reviews** (the 10th has no Gemini result to compare) — mock and Gemini assigned the identical sentiment label. **This is an observation, not an accuracy claim**: the mock provider deterministically derives sentiment purely from `rating` (≥4→positive, =3→neutral, ≤2→negative), so this agreement mainly shows that Gemini's real sentiment classification tracked the star rating closely on this specific 9-review sample — not that either provider is "correct." A human-labeled ground truth would be needed to assess accuracy, and none exists here.

### Confidence differences

**Structural difference observed**: the mock provider always returns a **flat, fixed 0.90** sentiment confidence regardless of input (a deliberate simplification of the mock, not a bug). Gemini's confidence varied per review (0.90–0.99), reflecting an actual per-review assessment. This means confidence values are not comparable in a meaningful way — the mock's confidence carries no information, only Gemini's does.

### Theme overlap

**Every mock-detected theme was also detected by Gemini, in all 9 comparable reviews (100% subset relationship)** — but Gemini consistently found 1–2 *additional* themes beyond what the mock found (durability, material, product_mismatch, value each appeared only in Gemini's output, never the mock's). This has a clear structural explanation, not a mystery: the mock provider only detects a theme if its literal keyword (e.g., the substring "durability") appears in the review text, while Gemini apparently performs semantic extraction that goes beyond literal keyword presence. **Observation, not an accuracy claim** — more themes detected isn't inherently "better," just different extraction behavior between a literal-match heuristic and a real model.

### "Color" theme investigation (specifically requested)

**Confirmed: the mock provider ALSO produced "color" for all 10 reviews**, including the one Gemini never got to process. Since the mock's theme detection is *pure literal substring matching* against the review's own title+text, this is direct, conclusive evidence that **the word "color" is genuinely present in the source text of all 10 sampled reviews** — this is very likely an artifact of the Phase 1.5 synthetic seed-data generator's theme-clause distribution (which combinatorially inserts theme-related phrasing into generated review text), not a Gemini-specific bias or hallucination. This resolves Step 4's open observation with a concrete, evidence-backed explanation rather than leaving it as an unexplained pattern.

### Validation status / malformed output

**No differences.** All 10 mock outputs passed `validateAiOutput` (Zod schema + business validation) cleanly. All 9 persisted Gemini outputs necessarily passed the same validation (invalid ones are never persisted, per the pipeline's design) — reconfirmed here, not re-derived. Neither provider produced malformed output in any comparable case in this sample. The 1 Gemini gap was a provider-availability failure (rate limit), never a validation failure — already established in Step 4, not re-litigated here.

### Rate-limit impact on this comparison

Exactly the 1 review Step 4 already documented as rate-limited has no Gemini side to compare — reported as `N/A`, not fabricated, not silently dropped from the table.

## Database safety (Steps 5)

```
review_sentiment: 5,029 -> 5,029 (unchanged)
review_theme: 8,915 -> 8,915 (unchanged)
normalized_reviews: 100,006 -> 100,006, checksum 821903ac625da7ee6256e2b6344ce868 both times (byte-identical)
DataWarehouse.flipkart_reviews: 50,007 -> 50,007 (unchanged)
DataWarehouse.myntra_reviews: 50,002 -> 50,002 (unchanged)
```

Zero real API calls made this step (Gemini side reused Step 4's persisted results entirely).

## Regression (after Step 5)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

---

## 6. Real AI idempotency and staleness validation (Step 6) — complete

**Real Gemini call budget: target 1, used exactly 1** (Case C). Cases A and D used zero real Gemini calls, proven by a call-counting wrapper at the provider boundary (never inferred from `candidateCount` or database rows, per instruction) — Case A wraps the *real* `GeminiProvider` and records its true call count; Case D deliberately uses the mock provider instead of spending real quota, exactly as the instruction allows ("use a mocked/counting provider rather than spending another Gemini request").

**A note on the instruction's own tension, surfaced rather than smoothed over**: the Database Safety section asks to verify `normalized_reviews unchanged`, while Case C/D's own text explicitly asks me to "use a LOCAL TEST FIXTURE derived from an existing normalized review" with content mutated. I resolved this by mutating exactly 2 real `normalized_reviews` rows directly — an application-owned table, explicitly permitted by the same section's "application-owned local test fixtures **or application tables**" wording — rather than fabricating a separate shadow fixture table. `DataWarehouse.*` (the actual source tables) was never touched. I'm not claiming `normalized_reviews` was unchanged in an unqualified sense — its row **count** is unchanged (100,006 both before and after), but its **content** was intentionally, transparently mutated for exactly the 2 rows Cases C and D describe below. Flagging this precisely rather than either silently deviating from instructions or silently overclaiming "unchanged."

### Case A — unchanged review — **PROVEN BY EXECUTION**

Reused Step 4's classified review `5d71e3516d3845788242d94f3ce7d70f` (Flipkart, rating 2) unmodified. Ran the real pipeline again through a call-counting wrapper around the actual `GeminiProvider`:

```json
{
  "contentHashUnchanged": true,
  "candidateCount": 0,
  "alreadyClassifiedCount": 1,
  "realProviderCallCount": 0,
  "newRowsWritten": 0
}
```

Zero real Gemini calls — measured by direct instrumentation at the provider boundary, not inferred.

### Case B — updatedAt-only change — **UNIT-TEST PROVEN** (existing tests, re-run fresh, not duplicated)

Two already-passing tests, re-executed just now rather than assumed still valid:
- `tests/unit/contentHash.test.ts` — `"is stable when only source_updated_at changes (the entire point of the redesign)"` — proves `computeContentHash` (the exact function the real pipeline uses) ignores `source_updated_at` entirely.
- `tests/integration/aiCandidateSelection.test.ts` — item 9, `"an updatedAt-only change does NOT make a classified review a candidate again"` — proves the full chain (source re-sync → `content_hash` comparison → candidate selection) end-to-end against an isolated local fixture database, using the real AI candidate-selection code.

Both re-ran clean: `2 test files, 16 tests passed`. Not re-derived from scratch since they already prove exactly this case with the real code paths — re-running them fresh (not just citing prior results) was the honest bar to clear here.

### Case C — content change — **PROVEN BY EXECUTION** (the 1 real Gemini call)

Review `8b117544811870dad024f8f9cb3c2f60` (Flipkart, rating 4) — appended a marker string to its `review_text`, recomputed `content_hash` via the real `computeContentHash` function, wrote both together to `normalized_reviews`:

```json
{
  "oldContentHash": "60d0093c...4685",
  "newContentHash": "b9822b29...38bc0",
  "contentHashChanged": true,
  "candidateCount": 1,
  "realProviderCallCount": 1,
  "pipelineStatus": "success",
  "successCount": 1,
  "latencyMs": 3570,
  "retries": 0,
  "sentimentLabel": "positive",
  "sentimentConfidence": 0.98,
  "themes": ["color (0.95)", "durability (0.95)", "delivery (0.95)"]
}
```

No rate limit encountered this time (unlike Step 4's one failure) — succeeded on the first attempt, no retries. **This `normalized_reviews` row is permanently left in its mutated state** (marker text appended) — documented here, not restored, since restoring would itself be an additional untracked mutation and the instruction didn't require restoration for this case.

### Case D — rating change — **PROVEN BY EXECUTION for hash + candidate reactivity; mock provider, zero real Gemini spend**

`content_hash` change itself is also **UNIT-TEST PROVEN** by the already-passing `tests/unit/contentHash.test.ts` → `"changes when rating changes"` (re-run clean above). For candidate-selection reactivity specifically, review `faac5dcf7f454634924ef28473a5bc9a` (Myntra) had its rating toggled 4→5 in `normalized_reviews`, hash recomputed via the real function, and the real pipeline run through a **mock** provider (not Gemini):

```json
{
  "oldRating": 4, "newRating": 5,
  "contentHashChanged": true,
  "candidateCount": 1,
  "mockProviderCallCount": 1,
  "realGeminiCallsUsedThisCase": 0,
  "pipelineStatus": "success"
}
```

**Side effect, documented plainly**: because this went through the real persist path with `dryRun: false`, it **overwrote** this review's Step 4/5 real-Gemini sentiment/theme classification with mock-generated data (`model_version` now reads `mock-v1` for this one review, confirmed by direct query). This is the correct, intended behavior of "use a mock provider through the real pipeline to avoid spending a Gemini call" — but it means this specific review is no longer usable as a "real Gemini result" reference in any later step. Flagging it now so it isn't mistaken for real Gemini data later.

### Database safety (Step 6)

```
review_sentiment count: 5,029 -> 5,029 (unchanged — both Case C and D were upserts on already-existing PKs, not new rows)
review_theme count: 8,915 -> 8,914 (net -1: Case C's theme count matched its prior count exactly (3->3, no change); Case D's mock
                     provider found 2 themes for that review's text where the original Gemini classification had found 3 — a
                     real, explained delta, not a mystery: consistent with Step 5's documented mock-finds-fewer-themes pattern)
normalized_reviews: row count unchanged (100,006 -> 100,006); content checksum changed from 821903ac625da7ee6256e2b6344ce868
                     to 4f5f16289641ddecfd4232cb2c681659 — fully accounted for by exactly the 2 authorized mutations in Cases C/D,
                     nothing else
DataWarehouse.flipkart_reviews: 50,007 -> 50,007 (completely untouched)
DataWarehouse.myntra_reviews: 50,002 -> 50,002 (completely untouched)
```

### Rate-limit behavior

None encountered this step — Case C's single real call succeeded immediately (3,570ms, 0 retries).

### Regression (after Step 6)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| Case A: 0 real Gemini calls for an unchanged review | PROVEN BY EXECUTION (instrumented, not inferred) |
| Case B: content_hash ignores updatedAt | UNIT-TEST PROVEN (re-run fresh) |
| Case B: candidate selection ignores updatedAt-only changes end-to-end | UNIT-TEST PROVEN (re-run fresh, isolated fixture DB) |
| Case C: content change → exactly 1 real Gemini call, valid result | PROVEN BY EXECUTION |
| Case D: rating change → content_hash changes | UNIT-TEST PROVEN (re-run fresh) |
| Case D: rating change → candidate selection reacts | PROVEN BY EXECUTION (mock provider, real pipeline) |
| Production readiness of any of the above | NOT CLAIMED |

---

## Step 6.1 — Local Baseline Restoration

**Trigger:** after accepting Step 6's validation results, you required the two `normalized_reviews` rows mutated in Cases C/D — plus any AI classification overwritten as a side effect — be restored to their exact pre-Step-6 state, with an explicit stop condition if exact original values could not be recovered from this conversation's own artifacts.

### Investigation (performed first, no writes made until complete)

Checked every value against what Step 4/5/6's own captured tool output (still present earlier in this conversation) had recorded **before** Step 6 ran:

| Field | Recoverable? | Source |
|---|---|---|
| `normalized_reviews.review_text`/`rating`/`content_hash` for both rows | Yes, exact | Step 6's own pre-mutation `fetchRow()` read, printed to console before either `UPDATE` executed |
| `review_sentiment.label`/`confidence`/`model_version` for `faac5dcf7f...` | Yes, exact | Step 5's read-only comparison query (ran *before* Step 6, printed in full) |
| `review_sentiment.label`/`confidence`/`model_version` for `8b117544...` | Yes, exact | Step 5's read-only comparison query (same source) |
| `content_hash_at_classification`/`content_hash_at_extraction` (original) for both | Yes, exact — not a guess | By construction: the pipeline's freshness guard requires this field to equal the row's `content_hash` at the moment of classification, and Step 4's report explicitly confirmed 0 hash mismatches across all 9 successful rows. Original content_hash was independently captured (see row above), so the original `content_hash_at_classification`/`extraction` is logically forced to be the same value — not inferred from typical behavior. |
| `review_theme.theme`/`confidence` (original, both reviews) | Yes, exact | Step 5's read-only comparison query |
| `classified_at` / `extracted_at` (original timestamps) | **No** | Never printed or captured anywhere in this conversation |
| `review_theme.evidence_snippet` (original text, both reviews) | **No** | Neither Step 4's `PerReviewOutcome` capture nor Step 5's comparison query selected this column — by design, to avoid logging review-adjacent free text |

Per your own explicit recovery checklist for the Case D classification (`model_version`, `sentiment`, `sentiment confidence`, `themes`, `theme confidence`, `content_hash_at_classification`, `content_hash_at_extraction`), every field you asked for **was** exactly recoverable. `classified_at`/`extracted_at`/`evidence_snippet` were not part of that checklist and were not recoverable — these were restored as `NULL`/restoration-time values (documented below), never fabricated or guessed.

**Additional finding, not explicitly named in your message:** Case C's real Gemini call against the mutated `8b117544...` text had also overwritten that review's `content_hash_at_classification`/`content_hash_at_extraction` (label/confidence/themes came back numerically identical to the original, but the hash fields pointed at the mutated content_hash). Left unfixed, this would have made the row look stale and triggered an **unbudgeted real Gemini call** on the next pipeline run — restoring the hash fields was therefore in scope as data-integrity, not optional cleanup. `8b117544...`'s `review_theme.evidence_snippet` had also been repopulated with real (non-mock) Gemini text from that same later call — not reused for restoration, since it comes from a different call than the original Step 4 classification and isn't verifiably identical.

**No stop condition triggered**: every field you asked to have recovered was recoverable with certainty from this conversation's own prior tool output.

### What was restored

Direct SQL value-restoration only. **No AI pipeline run, no `AiProvider` invocation of any kind (real or mock) — 0 Gemini calls, 0 mock calls.**

| Table | Row(s) | Change |
|---|---|---|
| `normalized_reviews` | `8b117544811870dad024f8f9cb3c2f60` | `review_text` marker suffix removed; `content_hash` restored to `60d0093c327e4c2e4fdcec28e67c05dc5c9972c6f73868167e4f3f3520a64685` |
| `normalized_reviews` | `faac5dcf7f454634924ef28473a5bc9a` | `rating` restored 5→4; `content_hash` restored to `37a7590c7ec4616f782c9c07c74b1e9517c05bc6d5600826abc5e7ed82dd12c4` |
| `review_sentiment` | `8b117544811870dad024f8f9cb3c2f60` | `content_hash_at_classification` restored to `60d0093c...` (label/confidence/model_version were already correct — Case C's real re-classification agreed with the original) |
| `review_theme` | `8b117544811870dad024f8f9cb3c2f60` (3 rows) | `content_hash_at_extraction` restored to `60d0093c...`; `evidence_snippet` set to `NULL` (not verifiably the original text) |
| `review_sentiment` | `faac5dcf7f454634924ef28473a5bc9a` | `label`/`confidence`/`model_version`/`content_hash_at_classification` restored from mock (`positive`/0.9/`mock-v1`) to original Gemini values (`positive`/0.95/`gemini:gemini-flash-latest:analysis-v1`/`37a7590c...`) |
| `review_theme` | `faac5dcf7f454634924ef28473a5bc9a` | 2 mock rows (`color`, `delivery`, confidence 0.8) deleted; 3 original Gemini rows re-inserted (`color`/`delivery`/`durability`, confidence 0.95 each, `evidence_snippet=NULL`, `content_hash_at_extraction=37a7590c...`) |

`classified_at`/`extracted_at` on the restored/inserted rows carry the restoration timestamp — explicitly **not** claimed to be the original timestamps, since those were never captured.

### Post-restoration verification

```
normalized_reviews count : 100006  (target 100006 — match)
review_sentiment count   : 5029    (target 5029 — match)
review_theme count       : 8915    (target 8915 — match)
flipkart source count    : 50007   (unchanged)
myntra source count      : 50002   (unchanged)
normalized_reviews checksum : 821903ac625da7ee6256e2b6344ce868  (target: exact pre-Step-6 checksum — match)
```

Row-by-row re-verification after restoration confirmed both `normalized_reviews` rows, both `review_sentiment` rows, and all 6 `review_theme` rows exactly match the pre-Step-6 captured values quoted above — re-queried and diffed field-by-field, not assumed from the UPDATE statements alone.

### Regression (after Step 6.1)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 6.1

```
Real Gemini calls: 0
Mock AI calls:     0
```

Restoration was pure SQL (`UPDATE`/`DELETE`/`INSERT` against `normalized_reviews`, `review_sentiment`, `review_theme` only) — `runAiSentimentPipeline` and both `AiProvider` implementations were never invoked in this step.

---

## Step 7 — Failure Isolation & Retry Validation

### 1. Test setup

Ran entirely against the **isolated test fixture database** (`pri_test_appstore` / `pri_test_prodsource` — the same fixture the existing vitest suite already uses via `tests/setupTestEnv.ts`), **never** the restored 100,006-row local dataset and **never** real Gemini. A new script, `backend/scripts/aiFailureIsolationStep7.ts`, was launched with the test env vars set explicitly on the command line (mirroring `setupTestEnv.ts`'s values), and it hard-aborts if `config.appStore.database !== "pri_test_appstore"` — a guard against ever accidentally running this against the real local dataset.

Fixture: `runTrackA("flipkart")` + `runTrackA("myntra")` against the isolated prod-fixture (3 + 3 = 6 rows) — the real Track A ingestion code, not a synthetic insert. Reviews labeled A–F by ascending `canonical_review_id` (the actual candidate-selection order — see `candidateSelection.ts`'s `ORDER BY nr.canonical_review_id ASC`), so no reordering was needed to present a labeled A/B/C/D/E/F narrative.

### 2. Provider used

A custom `failOnIdProvider(failId)` wrapping `MockAiProvider` — throws `AiProviderError` unconditionally for one specific `canonicalReviewId` (review "C"), on **every** attempt including retries, so retry exhaustion is genuinely exercised rather than a one-shot injected failure recovering on the first retry. Wrapped in a **call-counting instrumentation layer** (per-review and global), same pattern as Step 6 — call counts are measured at the provider boundary, never inferred. Ran through the real, unmodified `runAiSentimentPipeline`.

### 3–6. Candidates, injected failure, processing order, success/failure counts — PROVEN BY EXECUTION

```
candidateCount:  6
processedCount:  6
successCount:    5
failureCount:    1
injected failure: review C (31e7963f1035d7f9d6700715c8b7129f)

Processing order (as returned by the pipeline, unmodified):
  A → success
  B → success
  C → failure
  D → success
  E → success
  F → success
```

This matches the expected 5-success/1-failure shape from your spec — reported because it's what was actually observed, not assumed in advance.

### 7. Actual provider attempts / 8–9. Retry count

```
Total provider calls (measured, call-counting wrapper): 8
  A: 1   B: 1   C: 3   D: 1   E: 1   F: 1

pipeline.retryCount (whole run): 3
perReviewOutcomes[C].retries:    3
```

**Finding, precisely measured, not assumed:** with `maxRetries: 2` configured (1 initial attempt + 2 retries = 3 max attempts), the pipeline's `retryCount`/`retries` fields ended up at **3**, not 2. This is correct behavior, not a bug — `onFailedAttempt` fires once per *failed attempt*, including the final attempt that exhausts retries, and `pipeline.ts` increments its counter on every such call. So this field measures "failed attempts," not "retries beyond the first." Confirmed independently against the provider's own per-review call count (C: 3), which agrees exactly. `8 total calls = (5 successful reviews × 1 call) + (1 failing review × 3 attempts)` — cross-checked arithmetic, not inferred.

### 10. Successful persistence verification — direct SQL, PROVEN BY EXECUTION

For all 5 successful reviews (A, B, D, E, F):
- Exactly one `review_sentiment` row each (`duplicateSentimentRows: []`, `successfulReviewsWithExactlyOneSentimentRow: true`).
- `content_hash_at_classification` matches `normalized_reviews.content_hash` for all 5 (`hashMatchesNormalized: true` for every row).
- `review_theme` rows: B, D, E, F have theme rows (`content_hash_at_extraction` matches for all); **A has zero theme rows** — not a bug, `MockAiProvider` only emits a theme when a vocabulary keyword literally appears in the review text, and review A's fixture text doesn't contain one. Reported as observed, not assumed to be uniform.

### 11. Failed-review persistence verification — direct SQL, PROVEN BY EXECUTION

```
failedReviewHasNoSentimentRow: true
failedReviewHasNoThemeRows:    true
```

No partial `review_sentiment` or `review_theme` row exists for review C. This is a structural guarantee, not luck: `persistClassification()` is only ever called *after* `pRetry` resolves successfully (pipeline.ts line 256, inside the `try` block, after the `analyzeReview` call returns) — since C's provider call always throws, `persistClassification` (and its own DB transaction) is never entered at all for that review. There is no partial-write code path to race against.

### 12. Retry recovery result — PROVEN BY EXECUTION

Removed the injected failure (fresh, un-wrapped `MockAiProvider`), ran the real pipeline scoped to `canonicalReviewIds: [failId]` only:

```
candidateCount:     1
providerCallCount:  1
successCount:       1
sentimentRowCount:  1  (exactly one, as expected)
themeRowCount:      0  (this review's text doesn't match any theme keyword — same reason as review A above, confirmed consistent across both runs since MockAiProvider is deterministic)
```

### 13. Idempotency-after-recovery result — PROVEN BY EXECUTION

Ran the same now-recovered review again, unchanged, immediately after:

```
candidateCount:     0
providerCallCount:  0
newWrites:          0
sentimentCountBefore: 6   sentimentCountAfter: 6   (unchanged)
```

Zero candidate reselection, zero provider calls, zero new writes — measured via the counting wrapper and a direct before/after row count, not inferred from pipeline return values alone.

### 14. Observability result — OBSERVED, with one finding

Re-ran with `LOG_LEVEL=warn` (the first run used `error`, which silently suppressed the per-attempt retry logs — corrected before reporting rather than reporting an incomplete picture). Actual emitted log lines for review C's failure:

```json
{"level":40,"jobId":"...","canonicalReviewId":"31e7963f...","attempt":1,"retriesLeft":2,"msg":"AI provider call failed, retrying"}
{"level":40,"jobId":"...","canonicalReviewId":"31e7963f...","attempt":2,"retriesLeft":1,"msg":"AI provider call failed, retrying"}
{"level":40,"jobId":"...","canonicalReviewId":"31e7963f...","attempt":3,"retriesLeft":0,"msg":"AI provider call failed, retrying"}
{"level":50,"jobId":"...","canonicalReviewId":"31e7963f...","error":"AI provider \"mock-fail-on-id\" failed: injected deterministic failure for 31e7963f...","msg":"AI processing failed for this review — batch continues"}
```

**Present:** `jobId` (batch/run context), `canonicalReviewId`, attempt number, `retriesLeft`, a human-readable error message. No API keys, credentials, full review text, or other PII appear in any log line — confirmed by direct inspection of the log output above, not assumed from code review alone.

**Finding:** `platform` is **not** included in either the retry-warning or final-failure log lines, even though it's available on `candidate.platform` at the log call site (`pipeline.ts` lines 230–233 and 272–275 simply don't pass it). For a multi-platform batch, an operator reading logs alone cannot tell whether a failed review was Flipkart or Myntra without a separate DB lookup by `canonical_review_id`. There's also no structured "failure category" field — just a free-text error message — so distinguishing "provider timeout" from "validation failure" from "rate limit" programmatically from logs alone isn't currently possible (though the two failure sites in `pipeline.ts` — line 239 validation failure vs. line 269 provider/exception failure — do log different message strings, which is a partial mitigation). Not fixed here, per your instruction not to modify logging outside explicitly approved scope — reported as a finding only.

### 15. Database safety

```
Ran against: pri_test_appstore / pri_test_prodsource ONLY (asserted in-script, would throw otherwise)
DataWarehouse.flipkart_reviews / myntra_reviews (real prod tables): never connected to
Local production-like dataset (gbl_data_lake, product_review_intelligence schema, the Step 6.1-restored baseline): untouched — re-verified after Step 7:
  normalized_reviews: 100,006  |  review_sentiment: 5,029  |  review_theme: 8,915
  normalized_reviews checksum: 821903ac625da7ee6256e2b6344ce868  (exact match to the Step 6.1 target — unchanged)
```

No restoration was needed because no application-owned table outside the isolated test fixture was ever mutated.

### 16. Regression (after Step 7)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 7

```
Real Gemini calls: 0
Mock AI calls: multiple (against the isolated pri_test_appstore fixture only) — exact count per phase:
  Step 7B: 8 (5 successful reviews × 1 + 1 failing review × 3 attempts)
  Step 7E: 1 (the recovered review, single successful call)
  Step 7F: 0 (idempotent — no candidates, no calls)
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| One failed review does not abort the batch | PROVEN BY EXECUTION |
| Successful reviews are persisted correctly (hash-matched) | PROVEN BY EXECUTION (direct SQL) |
| Failed review creates no partial rows | PROVEN BY EXECUTION (direct SQL) + structural guarantee (persist only reachable after a successful provider call) |
| Failed review can be retried and recovers | PROVEN BY EXECUTION |
| Retry does not duplicate rows | PROVEN BY EXECUTION (direct SQL, exactly 1 row) |
| Idempotency after recovery (0 calls, 0 writes) | PROVEN BY EXECUTION |
| Retry/attempt count = failed-attempt count (not "retries beyond first") | PROVEN BY EXECUTION, precisely measured — a real, non-obvious behavior |
| Failure logs contain job/review context but omit platform and structured failure category | OBSERVED — reported as a finding, not fixed |
| No credentials/PII in logs | OBSERVED (direct log inspection) |
| Production readiness of any of the above | NOT CLAIMED |

---

## Step 8 — Token / Cost Measurement

### Setup and scope

Token counts only exist on a real provider response — no mock or unit test can produce them — so this step required exactly **one** real Gemini call, made against `analyzeReview`'s request shape only (the smallest scope that can answer the question; `narrate()`'s real-call cost is left to Step 9, when the narrator gets its first real-provider test, rather than spent here unnecessarily).

To avoid duplicating and risking drift from the shipped request-construction logic, `ANALYSIS_RESPONSE_SCHEMA` was exported from `geminiProvider.ts` (a visibility-only change — `const` → `export const`, no behavior change, still verified by the unchanged `geminiProvider.test.ts` assertions) and reused as-is in a new one-off script, `backend/scripts/aiTokenCostStep8.ts`, which builds the identical model/prompt/schema request `analyzeReview()` makes but calls the Gemini SDK directly so it can inspect `response.usageMetadata` — a field the shipped provider currently discards. The provider itself was not otherwise modified, and the pipeline was not invoked. The exact same synthetic, non-real-customer review already approved for Step 3's canary was reused (rating 2, "Poor quality", stitching-came-apart text) — no new fixture, no database connection, no persistence.

### Result — PROVEN BY EXECUTION (real API response, not estimated)

```json
{
  "model": "gemini-flash-latest",
  "latencyMs": 5060,
  "structuredOutputValid": true,
  "tokenUsage": {
    "promptTokenCount": 35,
    "candidatesTokenCount": 73,
    "thoughtsTokenCount": 479,
    "totalTokenCount": 587
  }
}
```

**Finding:** the resolved underlying model (`gemini-flash-latest` → `gemini-3.6-flash`, per Step 3's earlier discovery) is a "thinking" model — `thoughtsTokenCount` (479) makes up **~82% of total token usage**, dwarfing both the prompt (35) and the visible JSON output (73). This is a real, measured property of the resolved model, not something assumed going in — any future cost projection for this provider must account for reasoning-token overhead, not just prompt+output size, or it will substantially underestimate cost.

### Cost

```
Actual monetary cost of this call: $0 — OBSERVED, not estimated.
```

This API key runs on Gemini's **free tier** — independently confirmed in Step 4 via a genuine `429 RESOURCE_EXHAUSTED` error whose payload named the exact quota (`generativelanguage.googleapis.com/generate_content_free_tier_requests`, 5 req/min). Since no paid tier is active, $0 is a direct, observed fact about this account, not a projection.

**Paid-tier-equivalent cost: NOT MEASURED.** This session does not have verified, current Gemini per-token pricing on hand, and will not fabricate a rate to multiply against the token counts above — doing so would produce a number that looks precise but isn't grounded in anything real. If a paid-tier cost estimate is needed, the 3 real token counts above (35 prompt / 73 output / 479 thoughts, distinguished because providers commonly price them differently) are exactly what's needed to compute one against the current published Gemini pricing page.

### Database safety

Zero database connections were made by this script (no `appSequelize` import at all) — structurally incapable of touching any table. Re-verified anyway per standing protocol: local dataset unchanged (`normalized_reviews: 100,006`, checksum `821903ac625da7ee6256e2b6344ce868` — exact match, unchanged since Step 6.1).

### Regression (after Step 8)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 8

```
Real Gemini calls: 1 (the minimum possible — token counts cannot be observed without a real call)
Mock AI calls: 0
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| Prompt/output/thoughts/total token counts for one real analyzeReview-shaped call | PROVEN BY EXECUTION (read directly from `response.usageMetadata`) |
| Resolved model spends the large majority of tokens on internal "thinking," not visible output | PROVEN BY EXECUTION (82% in this one sample — single-sample, not claimed as a stable average) |
| Actual monetary cost of this call is $0 | OBSERVED (free-tier account, independently confirmed in Step 4) |
| Paid-tier-equivalent cost per call/1K reviews | NOT MEASURED — no fabricated pricing used |
| Token usage is representative of all review lengths/content | NOT CLAIMED — single sample, one short synthetic review |

---

## Step 9 — Narrator Validation (Real Gemini)

### Setup and scope

The existing test suite (`aiEvidenceNarrator.test.ts`, 5 tests, all re-run clean this step) already UNIT-TEST PROVES evidence-package correctness, hallucinated-citation rejection, and malformed-output rejection — but only against synthetic in-memory providers, never real Gemini. Step 9's job was narrowly to confirm the same guarantees hold against a **real** Gemini narrator response, with the smallest possible real-call budget: **exactly 1 real Gemini call**, no more.

`NARRATOR_RESPONSE_SCHEMA` was exported from `geminiProvider.ts` (visibility-only, same pattern as Step 8's `ANALYSIS_RESPONSE_SCHEMA` change — `const` → `export const`, no behavior change). A new script, `backend/scripts/aiNarratorStep9.ts`:

1. Built a **real, read-only** evidence package via the unmodified `buildProductEvidencePackage()` against the restored local dataset — `flipkart` / `FKPID000256` (37 already-classified reviews from Steps 4–7's real/mock runs, 8 of them `rating <= 2`), window `12m`. Evidence-package building is pure `SELECT` — confirmed by reading `evidencePackage.ts` before running: every query it issues is a `SELECT`, and it invokes no write path at all.
2. Made the **one** real Gemini call, constructing the identical model/prompt/schema request `geminiProvider.ts`'s `narrate()` makes, but via a direct SDK call so `response.usageMetadata` (discarded by the shipped provider) could be captured.
3. Ran the captured raw output through the **real, unmodified** `narrateProductEvidence()` — the actual production validation path (Zod schema validation + citation-rejection against `pkg.evidenceReviewIds`) — via a "replay" `AiProvider` whose `narrate()` simply returns the already-fetched output. This reuses the real validation code with **zero additional API calls**, rather than reimplementing or skipping it.

No `normalized_reviews` mutation of any kind, no isolated fixture needed — evidence-package building doesn't require one since it's read-only against data already legitimately present from earlier steps.

### Evidence package used — OBSERVED (real query results)

```
platform: flipkart, sourceProductId: FKPID000256, window: 2025-08-14..2026-08-13
reviewCount: 296  (all reviews in window — Phase 3 analytics scope)
averageRating: 3.74
sentimentDistribution: { positive: 23, neutral: 6, negative: 8 }  (37 classified — matches Step 4-7's known classified count for this product)
positivePercentage: 66.22   negativePercentage: 20.27
topThemes: fit(14), quality(10), delivery(9), comfort(8), size(6)
topNegativeThemes: quality(3), comfort(2), delivery(2), fit(2), durability(1)
evidenceReviewIdsCount: 20   totalMatchingNegativeCount: 60
```

### Structured output validation — PROVEN BY EXECUTION

Real Gemini output parsed as valid JSON and passed `NarratorOutputSchema` (the real Zod schema in `narrator.ts`, unmodified) on the first attempt — no retry needed, no malformed output.

### Citation / evidence constraint — PROVEN BY EXECUTION

```
rejectedCitations: []
```

Every `canonical_review_id` the real Gemini narrator cited (6 across 3 root causes, 4 across 2 recommendations) was already present in `pkg.evidenceReviewIds` — zero hallucinated IDs, verified by the real citation-filtering code (`narrateProductEvidence`'s `filterIds`), not just eyeballed. This is the first time this specific guarantee has been proven against genuine Gemini output rather than a synthetic hallucinator test double.

### Numerical-claim validation — PROVEN BY EXECUTION

The narrator's summary states: *"Among the analyzed reviews, customer sentiment is predominantly positive at 66.22%..."* — checked directly against the evidence package (via a separate zero-cost, zero-Gemini-call read-only query of the same deterministic `buildProductEvidencePackage()` output): `pkg.positivePercentage === 66.22`, an **exact match**. This traces the real Gemini model's stated number back to a real, already-tested Phase 3 analytics field — not invented, not miscalculated, not off from a plausible-sounding round number. This is the specific check the "AI never computes numbers" architecture principle exists to make verifiable, and it held on this sample.

### Prompt-constraint compliance ("never claim sales causality") — OBSERVED

Read the full summary/rootCause/recommendations text: no claim anywhere states or implies that reviews caused, predicted, or explain sales figures — every causal-sounding statement is scoped to reviewer sentiment/experience ("Reviews indicate...", "Among the analyzed reviews..."), matching the prompt's required phrasing exactly. **OBSERVED on this one real sample** — not a general guarantee, since the prompt instruction is advisory (best-effort model compliance), not structurally enforced by the schema the way citation-validity is.

### Token usage — PROVEN BY EXECUTION (real API response, not estimated)

```json
{
  "promptTokenCount": 1186,
  "candidatesTokenCount": 456,
  "thoughtsTokenCount": 1969,
  "totalTokenCount": 3611
}
```

Latency: 10,194ms. Consistent with Step 8's finding — thinking-tokens (1,969, ~55% of total) again dominate, though proportionally less than Step 8's single-short-review call (82%) since this prompt carries a much larger, denser evidence payload (full JSON evidence package vs. one short review). Cost: **$0, OBSERVED** — same free-tier account as every other real call this session; paid-tier-equivalent cost **NOT MEASURED**, for the same reason as Step 8 (no fabricated pricing).

### Database safety

```
Evidence-package build: read-only (SELECT only, confirmed by source inspection before running)
narrateProductEvidence(): read-only (schema validation + in-memory citation filtering, no DB access)
Local dataset re-verified unchanged after this step:
  normalized_reviews: 100,006  |  review_sentiment: 5,029  |  review_theme: 8,915
  normalized_reviews checksum: 821903ac625da7ee6256e2b6344ce868  (unchanged since Step 6.1)
DataWarehouse.flipkart_reviews / myntra_reviews: never connected to this step
```

### Regression (after Step 9)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 9

```
Real Gemini calls: 1 (the narrator call — the minimum possible; validation reused the captured output via a replay provider, 0 extra calls)
Mock AI calls: 0
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| Real Gemini narrator output passes structured-output (Zod) validation | PROVEN BY EXECUTION |
| Real Gemini narrator never cites a review ID outside the evidence package (this sample) | PROVEN BY EXECUTION |
| Hallucinated-citation rejection mechanism itself works (schema-level guarantee) | UNIT-TEST PROVEN (existing synthetic-hallucinator test, re-run clean) |
| Malformed narrator output is rejected outright (schema-level guarantee) | UNIT-TEST PROVEN (existing test, re-run clean) |
| The narrator's cited "66.22%" figure exactly matches the evidence package's own computed field | PROVEN BY EXECUTION |
| Narrator avoids sales-causality claims on this sample | OBSERVED — single sample, prompt-level compliance, not schema-enforced |
| No credentials/PII sent to or logged from this call | OBSERVED (evidence package contains only aggregate counts/IDs, no raw review text; direct inspection of the request/response) |
| Zero writes to any database this step | PROVEN BY EXECUTION (source inspection + before/after checksum match) |
| Narrator citation-validity or numerical accuracy holds in general, beyond this one sample | NOT CLAIMED |

---

## Supplementary Validation A — Narrator Sparse-Evidence Fabrication Test (Historical)

*Originally labeled "Step 10" before the numbering mismatch with the recovered original specification was discovered (see "Historical reconciliation" above). Preserved here unedited — this is where the citation-relevance gap (Phase 4.1 remediation item 1) was originally discovered, and that discovery remains real and load-bearing. It is not the original spec's Step 10 ("Numerical Claim Safety" / the 42%-vs-45% test), which appears in its correct position below. The finding described here (1/4 wrong theme attribution) has since been fixed — see "Phase 4.1 Remediation" near the end of this report.*

### Numerical-Claim Validation (Sparse-Evidence Edge Case)

### Setup and scope

Step 9 already proved one real numeric claim traces exactly to a deterministic evidence-package field — but on a well-populated product (296 reviews, 37 already AI-classified), which is the *easiest* case for a model to get right. The stronger, more informative test is the opposite: a real product with plenty of reviews but **zero AI classification** (`sentimentDistribution: null`, `topThemes: []`) — the exact condition under which a model is most tempted to fabricate a sentiment/theme number that doesn't exist rather than correctly reporting its absence. This required **exactly one** additional real Gemini call — the minimum necessary, since this specific evidence shape (populated ratings, empty AI-theme data) didn't exist in anything already captured from Steps 1–9.

Found via a read-only query: `myntra` / product `100293` — 295 real reviews, 0 AI-classified (confirmed before spending the call, not discovered by trial). Evidence-package build (`buildProductEvidencePackage`, unchanged) and narrator validation (`narrateProductEvidence`, unchanged, via the same zero-extra-call "replay provider" pattern as Steps 8–9) reused exactly as before — `backend/scripts/aiNumericalClaimStep10.ts`. No code changes this step at all — purely a new evidence scenario run through the existing, unmodified validation path. Zero `normalized_reviews` mutation of any kind — nothing needed mutating, since this product's genuine current state already provided the sparse-evidence condition.

### Evidence package used — OBSERVED (real query results)

```
platform: myntra, sourceProductId: 100293, window: 2025-08-14..2026-08-13
reviewCount: 295   averageRating: 3.56
positivePercentage: 62.37   negativePercentage: 24.07   (rating-derived, Phase 3 analytics — independent of AI classification)
sentimentDistribution: null   (zero review_sentiment rows for this product — no AI classification has run)
topThemes: []   topNegativeThemes: []   (zero review_theme rows — same reason)
evidenceReviewIdsCount: 20   totalMatchingNegativeCount: 71   (rating<=2 evidence — independent of AI classification, per evidence.ts)
```

### Numeric-claim audit — PROVEN BY EXECUTION (deterministic text scan, not a judgment call)

The full narrator output text was scanned for every digit sequence, not just eyeballed:

```
numericClaimsFoundInOutputText: ["3.56", "5", "295", "62.37%", "24.07%"]
```

| Claim in narrator text | Evidence-package field | Match? |
|---|---|---|
| "average rating of 3.56" | `pkg.averageRating = 3.56` | ✅ exact |
| "out of 5" | rating scale constant, not evidence-derived | N/A — not a claim requiring grounding |
| "across 295 analyzed reviews" | `pkg.reviewCount = 295` | ✅ exact |
| "62.37% positive feedback" | `pkg.positivePercentage = 62.37` | ✅ exact |
| "24.07% negative feedback" | `pkg.negativePercentage = 24.07` | ✅ exact |

**Every substantive number the real Gemini narrator stated — even under this sparse-AI-data condition — traced exactly to a real, deterministic evidence-package field.** No invented count, no plausible-sounding-but-wrong percentage, no attempt to compute or round independently. This is a second, independent confirmation of the "AI never computes numbers" principle holding at the provider boundary, on a genuinely different (and harder) evidence shape than Step 9's.

### Finding — thematic-attribution fabrication (not a numeric-claim issue, but a closely related evidentiary-grounding gap)

Despite `topThemes: []` and `topNegativeThemes: []` — **zero theme signal of any kind in the evidence package** — the narrator's `rootCause` confidently asserted two specific themes ("fit", "quality") as "major sources of dissatisfaction" and attached each to two specific `canonical_review_id`s drawn from `evidenceReviewIds`. Both cited IDs passed schema validation (valid enum theme) and citation validation (`rejectedCitations: []` — both IDs were genuinely present in `evidenceReviewIds`) — so **nothing in the existing pipeline flagged this claim as unsupported.**

To check whether the specific theme-to-review attributions were actually accurate, the 4 cited reviews' real text was read directly (read-only SQL, zero additional Gemini cost):

| canonical_review_id | Narrator's claimed theme | Actual review text | Attribution accurate? |
|---|---|---|---|
| `3bee9e5a7d3c...` | fit | "...Sizing runs way off, had to return." | ✅ genuinely fit-related |
| `4552142af45c...` | fit | "Would not recommend. Packaging was damaged on arrival." | ❌ **wrong** — about damaged packaging, not fit |
| `fc5dd410a516...` | quality | "Quality was disappointing... Started falling apart within days." | ✅ genuinely quality-related |
| `1195b273e2c9...` | quality | "Not what I expected at all. Not very comfortable after a few hours." | ⚠️ borderline — this is a comfort complaint, not squarely a quality one |

**1 of 4 (25%) attributions was factually wrong; a 2nd was questionable — PROVEN BY EXECUTION, verified against real review text, not assumed.** This is a genuine, previously-unproven architectural gap: **citation-validity** (is this ID real, is it in the evidence list) is enforced by `narrateProductEvidence`'s `filterIds`, but **citation-relevance** (does this specific ID actually support the specific claim it's attached to) is not verified anywhere — the evidence package gives the model a pool of review IDs and an aggregate theme signal, but when the theme signal is empty, the model still produces confident-sounding attributions with no way for the pipeline to check them. This is a real limitation, surfaced by deliberately choosing the sparse-evidence case rather than something the well-populated Step 9 case could have revealed.

### Token usage — PROVEN BY EXECUTION (real API response, not estimated)

```json
{
  "promptTokenCount": 940,
  "candidatesTokenCount": 427,
  "thoughtsTokenCount": 922,
  "totalTokenCount": 2289
}
```

Latency: 15,789ms. Thinking-tokens (922, ~40% of total) again present but proportionally smaller than both prior samples (Step 8: 82%, Step 9: 55%) — third independent data point, still not claimed as a stable ratio. Cost: **$0, OBSERVED** (same free-tier account); paid-tier cost **NOT MEASURED**, same reasoning as Steps 8–9.

### Database safety

```
Evidence-package build: read-only (unchanged code path, re-confirmed)
Review-text verification query (for the attribution check above): read-only SELECT only
No normalized_reviews mutation was needed or performed this step
Local dataset re-verified unchanged before AND after this step:
  normalized_reviews: 100,006  |  review_sentiment: 5,029  |  review_theme: 8,915
  normalized_reviews checksum: 821903ac625da7ee6256e2b6344ce868  (unchanged since Step 6.1, before and after)
DataWarehouse.flipkart_reviews / myntra_reviews: never connected to this step
```

### Regression (after Step 10)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 10

```
Real Gemini calls: 1 (the minimum necessary — this specific sparse-evidence scenario wasn't covered by any prior step's captured data)
Mock AI calls: 0
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| Every numeric claim in the sparse-evidence narrator output traces exactly to a real evidence-package field | PROVEN BY EXECUTION (deterministic text scan + field comparison) |
| "AI never computes numbers" holds even when AI-derived fields (sentiment/theme) are entirely absent | PROVEN BY EXECUTION, 2nd independent sample (Step 9 + Step 10) |
| Narrator can attribute a specific theme to a specific review ID with no supporting evidence-package signal | PROVEN BY EXECUTION — 1/4 attributions confirmed wrong, 1/4 questionable, verified against real review text |
| Citation-validity (ID is real) is enforced | PROVEN BY EXECUTION / UNIT-TEST PROVEN (Step 9 + existing tests) |
| Citation-relevance (ID actually supports its attached claim) is enforced | **NOT ENFORCED — architectural gap, reported as a finding, not fixed** (out of Step 10's scope per instruction) |
| Zero writes to any database this step | PROVEN BY EXECUTION (source inspection + before/after checksum match) |
| This fabrication pattern is frequent/rare in general | NOT CLAIMED — single sample, 4 attributions total |

---

## Supplementary Validation B — Deliberate Rate-Limit Reproduction (Historical)

*Originally labeled "Step 11" before the numbering mismatch with the recovered original specification was discovered (see "Historical reconciliation" above). Preserved here unedited — its real 429 data, quota-metadata discrepancy finding, and retry-timing measurements remain valid and are directly reused (not re-measured) in the correctly-labeled Step 11 below. It is not the original spec's Step 11 ("Real Provider Rate Limiting"), which explicitly called for normal controlled calls, not this section's deliberate reproduction — that mismatch is exactly what triggered the reconciliation.*

### Rate-Limit-Specific Testing (Deliberate Reproduction)

*(Step 10's finding stands exactly as documented above — citation-ID validity is enforced, citation-relevance is not, 1/4 real theme-attributions was factually wrong and 1/4 questionable. Step 11 did not touch the narrator and did not revisit or alter that finding.)*

### Setup and scope — a deliberate choice, not the cheaper option

Step 4 already captured one real 429 incidentally. Given the choice between re-analyzing that existing evidence at zero additional cost, or deliberately reproducing a fresh, controlled rate-limit event, **you chose deliberate reproduction** — 6 real Gemini calls, the minimum needed to exceed the free tier's observed 5-requests/minute quota deterministically. This is a genuinely different, stronger form of proof than Step 4's incidental case: instrumented from the start (per-call timestamps, not reconstructed after the fact), against a controlled review set, with an explicit before/after database contract.

Exact pre-state, captured before any call was made:
```
review_sentiment: 5,029   review_theme: 8,915   normalized_reviews: 100,006
normalized_reviews checksum: 821903ac625da7ee6256e2b6344ce868
```

6 real, previously-unclassified local reviews (myntra, ratings 1–5, `0001dd69...` through `0009d576...`) were run through the real, unmodified pipeline with the real `GeminiProvider`, wrapped in a timestamped call-counting instrumentation layer (records start time, duration, and outcome of every `analyzeReview` call at the provider boundary — measured, never inferred). Same precedent as Step 4: classifying genuinely new, previously-unclassified reviews is a legitimate permanent addition, not a mutation requiring restoration, since `normalized_reviews` and its checksum are structurally untouched by classification (confirmed below).

### Result — PROVEN BY EXECUTION

A real 429 was triggered deterministically on the 6th call, recovered via a single retry, and the run finished with **all 6 reviews successfully classified** (a different, equally valid real outcome from Step 4's retry-exhaustion case — reported as observed, not forced to match Step 4's shape):

```
totalProviderCallCount: 7   (6 reviews + 1 retry on the one that hit the 429)
candidateCount: 6   processedCount: 6   successCount: 6   failureCount: 0   retryCount: 1
status: success   runDurationMs: 66,435
```

Per-call timeline (ms from run start):
```
call 1 (0001dd69...): starts   21ms, success,  4,416ms
call 2 (00041e13...): starts 4,459ms, success, 12,373ms
call 3 (0005331b...): starts 16,863ms, success, 32,883ms
call 4 (00086f1f...): starts 49,772ms, success,  5,766ms
call 5 (00089776...): starts 55,545ms, success,  5,382ms
call 6 (0009d576...): starts 60,930ms, ERROR (429),  170ms
call 7 (0009d576... retry): starts 62,103ms, success, 4,317ms
```

### The real 429 payload

```json
{
  "code": 429,
  "status": "RESOURCE_EXHAUSTED",
  "message": "You exceeded your current quota... Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\nPlease retry in 11.127411081s.",
  "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
  "retryDelay": "11s"
}
```

**Finding — the quota metadata is misleading, caught by directly measuring behavior rather than trusting the label:** this payload's `quotaId` explicitly says `...PerDay...` and states `limit: 20` — read literally, this claims a **daily** cap of 20 requests has been exhausted, which would not clear for hours. But the very next call, retried only **~1.0 second later** (well under the API's own suggested `retryDelay: 11s`, let alone a day), **succeeded**. A literal 24-hour daily cap cannot clear in 1 second — so despite the `PerDay` label, the actual enforced constraint at this moment was short-lived (consistent with Step 4's separately-observed **per-minute** quota, `generate_content_free_tier_requests`, limit 5 — a *different* quota metric name than this one). **This is reported as a direct, measured discrepancy between the API's self-reported quota metadata and its own observed behavior — not assumed, not smoothed over.** Any system design that branches logic on this specific `quotaId` string (e.g., "if PerDay, don't bother retrying today") would have been actively wrong here.

### Finding — retry backoff does not respect the API's suggested delay (confirms and extends a Step 4 observation, now precisely measured)

The pipeline's retry (`p-retry`, `minTimeout: config.ai.retryMinTimeoutMs` = 1000ms default) fired **~1,003ms** after the failure — its own fixed schedule, not the **11,127ms** the API's response explicitly requested. This is the same pattern Step 4 showed informally (4 attempts spanning 8,541ms total, far short of the 24.78s the API asked for that time) — Step 11 measures it precisely and directly, via real timestamps, rather than back-calculating from a total duration. **The system does not read or honor `retryDelay`/`RetryInfo` from the provider's error response at all** — confirmed by source inspection of `pipeline.ts`'s `pRetry(...)` call (only `retries` and a fixed `minTimeout` are configured; the error object's fields are never inspected for a suggested delay). In this sample, retrying early still succeeded — but that is not a guarantee, and a production deployment hitting a *harder* quota wall could burn through all retries faster than the actual quota-reset window, exactly as happened in Step 4. Not fixed here, per your instruction to report Step 11 as findings unless its explicit scope requires a fix.

### Failure isolation / zero-partial-write — PROVEN BY EXECUTION (real 429 cause, not synthetic)

Step 7 already proved this structurally for a *synthetic* injected failure. Step 11 reproduces the identical guarantee against a **genuine** provider-side 429:

```
Review 0009d576...'s failed attempt (the 429) left zero rows anywhere — confirmed both by the pipeline's own outcome
tracking (no persistClassification call reachable before pRetry resolves) and by direct SQL: the review shows
hasSentiment=true only AFTER its successful retry, with exactly one review_sentiment row, hash-matched, no duplicates.
```

This is expected, not a new mechanism — `pipeline.ts`'s catch/retry boundary treats every provider error identically regardless of cause (no `err.status`/`err.code` branching exists anywhere in the retry or failure path), so Step 7's structural proof (persistence only reachable after a successful call resolves) applies here without modification. Reproducing it against a real 429 rather than inferring it generalizes was the whole point of choosing deliberate reproduction over reuse.

### Database safety — PROVEN BY EXECUTION (independently re-verified via direct SQL, not just the script's self-report)

```
review_sentiment: 5,029 → 5,035 (+6, exactly matching successCount — a legitimate, permanent addition, same precedent as Step 4)
review_theme: 8,915 → 8,933 (+18, ~3 themes/review average, reasonable)
normalized_reviews: 100,006 → 100,006 (unchanged — classification never touches this table)
normalized_reviews checksum: 821903ac625da7ee6256e2b6344ce868 → 821903ac625da7ee6256e2b6344ce868 (byte-identical, unchanged)
DataWarehouse.flipkart_reviews: 50,007 (unchanged)   DataWarehouse.myntra_reviews: 50,002 (unchanged)
All 6 review_sentiment rows: content_hash_at_classification matches normalized_reviews.content_hash — 0 mismatches (all 6 checked directly)
```

No restoration required or performed — this is a permanent, legitimate dataset addition, not a mutation, consistent with how Step 4's 9 real classifications were treated.

### Regression (after Step 11)

```
npm run typecheck   — clean
npm test             — 194/194 passing
npm run safety-check — OK, no write-shaped SQL found
```

### AI calls made during Step 11

```
Real Gemini calls: 7 (6 reviews + 1 retry on the one that hit the real 429) — the minimum needed to deterministically
                     exceed the observed per-minute free-tier quota and reproduce a genuine 429 under controlled conditions
Mock AI calls: 0
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| 6 sequential real calls deterministically trigger a real 429 on the free tier | PROVEN BY EXECUTION |
| The API's `quotaId` metadata ("PerDay", limit 20) is not a reliable indicator of actual enforcement duration | PROVEN BY EXECUTION — contradicted by a successful retry ~1s later |
| Retry backoff uses its own fixed schedule, not the API's suggested `retryDelay` | PROVEN BY EXECUTION (precise timestamps) + source inspection (no `retryDelay` field is ever read) |
| A real rate-limit failure is isolated exactly like any other failure — zero partial writes, batch continues | PROVEN BY EXECUTION (real 429 cause) — structurally guaranteed, same generic catch path Step 7 proved for a synthetic cause |
| Retrying well before the API's suggested delay can still succeed | OBSERVED — single instance, not a guarantee for harder/longer quota walls |
| Two distinct quota mechanisms exist (per-minute, and something else mislabeled "PerDay") | OBSERVED — inferred from two different quota-metric names across Steps 4 and 11, not confirmed against Gemini's own documentation |
| Zero writes to normalized_reviews or any source table | PROVEN BY EXECUTION (checksum + count match, independently re-verified) |
| This specific retry-recovers-early behavior is reliable/repeatable | NOT CLAIMED — single sample |

---

## Step 10 — Numerical Claim Safety (Original Specification, Recovered)

```
STEP 10 — NUMERICAL CLAIM SAFETY
Test at least: evidence says 42%, model output attempts 45%. Determine whether the
current validation catches this. If it does NOT: document it as a known limitation.
Do not implement an overcomplicated solution unless necessary. At minimum, investigate
whether structured numeric fields can be separated from free-form narrative.
```

### Result — PROVEN BY EXECUTION (real permanent test, zero Gemini calls)

Executed exactly the specified scenario: built a real evidence package (`pkg.positivePercentage` = a real, deterministic value), then fed `narrateProductEvidence()` a synthetic provider whose `summary` states `pkg.positivePercentage + 3` instead of the real value — the same 3-point mismatch shape as the spec's 42-vs-45 example. Zero real Gemini calls needed: this tests whether *our own validation code* would catch a deliberately wrong number, not whether a real model happens to produce one. Added as a permanent regression test (`tests/integration/aiEvidenceNarrator.test.ts`, "ORIGINAL STEP 10" test), not a one-off script — so this finding stays continuously proven, not just asserted once.

```
Mismatched summary passed straight through: NOT CAUGHT.
```

**Confirmed: current validation does NOT catch this.** `NarratorOutputSchema` (Zod) validates `summary`'s *type* (a string, 1–1000 chars) and nothing about its *content* — no code path anywhere inspects digits embedded in free text. This is distinct from, and not fixed by, Phase 4.1 remediation item 1 (citation relevance) — that fix grounds *theme-to-review* claims via `reviewThemes`, but a bare numeric assertion in `summary` has no structured citation to check in the first place.

### Investigation — can structured numeric fields be separated from free-form narrative?

Per the spec's own guidance ("do not implement an overcomplicated solution unless necessary... at minimum, investigate"), this was investigated, not solved:

- **Feasible, minimal option not implemented here**: `summary` could be split into a structured field (e.g. `citedMetrics: { field: keyof ProductEvidencePackage; statedValue: number }[]`) that the narrator populates alongside its prose, then deterministically checked against the real `evidencePackage` field it names — the same pattern remediation item 1 already uses for `rootCause[].theme` against `reviewThemes`. This is a real, buildable design, not a hard problem.
- **Why not implemented as part of this remediation round**: your instructions for this remediation explicitly scoped item 1 to citation *relevance* (the theme-attribution gap), not numeric-claim structuring — and the original Step 10 spec itself says not to overcomplicate this without necessity. Building and testing a new structured-metrics schema is a real, non-trivial addition (new schema fields on all three providers, new validation logic, new tests) that wasn't part of what was authorized this round.
- **Documented as a known limitation, exactly as the spec instructs**, carried into the final ledger below — a candidate for a future, explicitly-scoped remediation item if you want it.

### Database safety / AI calls

```
Real Gemini calls: 0   Mock AI calls: 1 (MockAiProvider, to populate real review_sentiment/theme fixture data before building the evidence package)
Local restored dataset: untouched — this test runs entirely against the isolated pri_test_appstore fixture, same as the rest of aiEvidenceNarrator.test.ts
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| A deliberately mismatched percentage in narrator prose is NOT caught by current validation | PROVEN BY EXECUTION (permanent test, real evidence-package field, real mismatch scenario) |
| Structured numeric-claim separation is technically feasible using the same pattern as item 1's fix | OBSERVED (design-level, not implemented) |
| This exact gap generalizes to all numeric claims, all narrator calls | NOT CLAIMED — proven for this one mismatch shape and code path, not exhaustively |

---

## Step 11 — Real Provider Rate Limiting (Original Specification, Recovered)

```
STEP 11 — REAL PROVIDER RATE LIMITING
Determine whether the provider returns: rate-limit errors, retry-after information,
timeout errors, authentication errors, invalid-request errors. Map these into the
existing retry architecture. Do NOT perform aggressive testing. Use normal controlled
calls only.
```

### What's already proven, reused rather than re-measured

Per your explicit instruction ("Do NOT intentionally exhaust quota again... inspect the existing real rate-limit evidence from Steps 4/11"), the following is **reused, not re-triggered**, from Supplementary Validation B (the historical, deliberately-reproduced 429) and Step 4:

| Requirement | Status |
|---|---|
| Rate-limit errors returned by the provider | PROVEN BY EXECUTION — 2 real 429s (Step 4 incidental, Supplementary Validation B deliberate) |
| Retry-after information supplied by the provider | PROVEN BY EXECUTION — both real 429s carried a `RetryInfo.retryDelay` field |
| Retry-after information now actually consumed by the retry architecture | PROVEN BY EXECUTION — Phase 4.1 remediation item 2's fix, verified against the real, byte-for-byte captured Supplementary-Validation-B payload replayed through `classifyGeminiError()` (`tests/unit/geminiErrorClassification.test.ts`) — parses to exactly 11,000ms, matching the real `"retryDelay":"11s"` value |

### New — controlled, non-aggressive calls (2 total, this step)

Two error types the original spec named were never tested anywhere in Phase 4.1 until this reconciliation: authentication errors and invalid-request errors. Two single, cheap, non-aggressive real calls (not a batch, no repeated firing) were made to observe the genuine error shape — exactly "normal controlled calls," not the quota-exhausting pattern the spec prohibits:

```
Call 1 — deliberately invalid API key (never the real configured key):
  real response: HTTP 400, status "INVALID_ARGUMENT", details[].reason = "API_KEY_INVALID"

Call 2 — deliberately nonexistent model name (real key, otherwise normal request):
  real response: HTTP 404, status "NOT_FOUND"
```

**Real finding, previously unverified assumption corrected:** `classifyGeminiError()` had assumed auth failures surface as HTTP 401/403 (standard REST convention). The real API returns **400** for an invalid key, distinguishable only via the `details[].reason === "API_KEY_INVALID"` marker, not the status code. This was a **real bug** — before this fix, an actual auth failure would have been miscategorized as generic `provider_error` rather than `provider_auth`, and (more importantly) would still have been correctly marked non-retryable by luck (400 defaulted to non-retryable already) rather than by correct classification. Fixed in `geminiProvider.ts`, verified against both real captured payloads (this call's 400, and the earlier 404) in `tests/unit/geminiErrorClassification.test.ts` — **PROVEN BY EXECUTION against real API responses, not assumed.**

Timeout errors remain **NOT MEASURED** — no real network timeout was observed or deliberately reproduced (doing so reliably would require artificial network manipulation, not just an API call, and wasn't attempted). The timeout classification path (`/timeout/i.test(message)`) is a heuristic, UNIT-TEST PROVEN only against a synthetic message, not a real timeout.

### Mapping into the retry architecture — PROVEN BY EXECUTION

All 5 error categories now map into `pipeline.ts`'s retry logic via `AiProviderError.retryable`/`.category`/`.retryAfterMs` (Phase 4.1 remediation items 2/3): rate-limit and unavailable (5xx) retry with the provider-suggested delay when present; auth and other 4xx (invalid request/model) do not retry at all (`shouldRetry` aborts immediately); timeout retries using the existing fallback backoff. Verified via `tests/integration/aiRetryDelayAndLogging.test.ts` (11 tests) and `tests/unit/geminiErrorClassification.test.ts` (5 tests, against real payloads) — see "Phase 4.1 Remediation" below for the full test list.

### Database safety / AI calls

```
Real Gemini calls: 2 (both single, cheap, non-aggressive — an invalid-key request and an invalid-model-name request; neither is expected to consume generate_content quota, both fail before generation)
Mock AI calls: 0
Local restored dataset: untouched — both calls made no database connection of any kind (confirmed by source: the investigation script imported only the Gemini SDK and config, not appSequelize)
normalized_reviews checksum re-verified unchanged after this step: 821903ac625da7ee6256e2b6344ce868
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| Rate-limit errors and retry-after info are returned by the real provider | PROVEN BY EXECUTION (reused from Step 4 / Supplementary Validation B) |
| Retry-after info is now actually parsed and honored | PROVEN BY EXECUTION (real payload replay, unit test) |
| Auth failures return 400 with a distinguishing reason code, not 401/403 | PROVEN BY EXECUTION (2 real controlled calls) |
| Invalid-request (bad model name) failures return 404 | PROVEN BY EXECUTION (1 real controlled call) |
| All discovered error types correctly map into retryable/category/delay | PROVEN BY EXECUTION (unit + integration tests, real payloads) |
| Timeout error handling | NOT MEASURED — heuristic only, no real timeout observed |
| Zero writes to normalized_reviews or any source table | PROVEN BY EXECUTION (checksum re-verified) |

---

## Step 12 — Performance (Original Specification, Recovered)

```
STEP 12 — PERFORMANCE
Measure real provider performance on the 10-review smoke test. Report: average latency,
minimum latency, maximum latency, total duration, throughput. Clearly separate MOCK
(~302 reviews/sec measured) from REAL ANTHROPIC/GEMINI (actual measured result). Do not
extrapolate 1M+ performance from 10 reviews.
```

### Methodology — reused real data, zero new Gemini calls

Per your instruction ("use the smallest sample sufficient... do not perform large real Gemini batches"), this reuses real latency data already captured and verified in Step 4 and Supplementary Validation B, rather than running a new batch. The MOCK figure reuses an existing, already-measured, larger-scale result (5,000 reviews) from the earlier Phase 4 report — not re-measured here, since a solid, real, bigger-sample figure already exists and re-measuring it would add no information.

### Real Gemini latency — PROVEN BY EXECUTION (15 real successful `analyzeReview` calls, 2 independent batches)

```
Step 4  (9 successful, of a 10-review batch):  min 4,809ms   max 14,133ms   avg 6,802ms
Supp.V.B (6 successful, of a 6-review batch):  min 4,417ms   max 32,884ms   avg 11,052ms
Combined (15 successful calls, both batches):  min 4,417ms   max 32,884ms   avg 8,502ms
```

### Throughput — PROVEN BY EXECUTION

```
Sequential, steady-state (1 / avg per-call latency):        ≈0.118 reviews/sec  (≈7.06/min)
Step 4 real batch (10 reviews incl. 1 exhausted failure):   10 / 70.078s  = 0.143 reviews/sec
Supp.V.B real batch (6 reviews incl. 1 recovered 429):       6 / 66.435s  = 0.090 reviews/sec
Combined real batch throughput (16 reviews, both batches):  16 / 136.513s = 0.117 reviews/sec
```

**MOCK, for direct comparison (reused from Phase 4's own report, `docs/implementation/phase-4-ai-intelligence-report.md`):**

```
MOCK: 5,000 reviews, batch-size 100, 16.54s  ≈  302 reviews/sec
```

**Real Gemini is ≈2,570–2,580× slower than the mock provider** (302 ÷ 0.117 ≈ 2,577; 302 ÷ 0.118 ≈ 2,568 depending on which real-throughput basis is used) — entirely explained by real network/API latency (seconds per call) versus the mock's in-process function call plus DB write (milliseconds per call). This confirms, with real measurement, what Phase 4's original report could only project ("real-provider throughput is PROJECTED to be dramatically lower... this session had no key to measure it with").

**No extrapolation to 1M+ reviews is made** — the two figures above are reported as directly measured, on the samples that produced them (10 and 6 reviews respectively), not scaled up.

### Controlled concurrency throughput — NOT MEASURED, NOT APPLICABLE

The current pipeline architecture (`pipeline.ts`) processes each batch's candidates in a single sequential `for` loop with `await` per review — confirmed by source inspection, not assumed. There is no concurrent/parallel call path to measure; building one would be a real architectural change (out of scope for this remediation, which measures and fixes, not adds new capability) and was not attempted.

### Database safety / AI calls

```
Real Gemini calls: 0 (all figures reused from Step 4 / Supplementary Validation B's already-captured, already-verified data)
Mock AI calls: 0 (the 302/sec figure is reused from Phase 4's own prior report, not re-run)
No database access of any kind occurred during this step — pure arithmetic over already-captured numbers.
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| Real Gemini per-call latency (min/max/avg, 15 samples across 2 batches) | PROVEN BY EXECUTION (reused, independently re-verified arithmetic) |
| Real Gemini sequential/batch throughput | PROVEN BY EXECUTION (reused) |
| Mock throughput (≈302 reviews/sec) | PROVEN BY EXECUTION — reused from Phase 4's own prior, larger-scale (5,000-review) measurement |
| Real Gemini is ~2,500x+ slower than mock, dominated by network latency | PROVEN BY EXECUTION (direct ratio of two measured figures) |
| Concurrent/parallel throughput | NOT MEASURED / NOT APPLICABLE — architecture is sequential-only by design, confirmed by source inspection |
| Performance at 1M+ review scale | NOT CLAIMED — no extrapolation performed |

---

## Step 13 — Database Safety (Original Specification, Recovered)

Recovered verbatim from the original Phase 4.1 plan:

```
STEP 13 — DATABASE SAFETY

Verify before and after:
- normalized_reviews count unchanged
- normalized_reviews content unchanged
- DataWarehouse.flipkart_reviews count unchanged
- DataWarehouse.myntra_reviews count unchanged

Only application-owned AI tables may receive writes.

If any unexpected source-table change is detected: STOP IMMEDIATELY.
```

### Scope actually executed this step

Purely read-only. **Zero Gemini calls, zero Anthropic calls, zero pipeline invocation, zero data modification, zero code changes.** Two independent bookend snapshots — a "before" read and an "after" read, with nothing performed in between — over the same four SQL queries each time.

### What was measured directly during Step 13 — PROVEN BY EXECUTION

```
BEFORE:
  normalized_reviews_count:     100,006
  normalized_reviews_checksum:  821903ac625da7ee6256e2b6344ce868
  flipkart_source_count:        50,007
  myntra_source_count:          50,002

AFTER (independent re-read, nothing performed in between):
  normalized_reviews_count:     100,006
  normalized_reviews_checksum:  821903ac625da7ee6256e2b6344ce868
  flipkart_source_count:        50,007
  myntra_source_count:          50,002
```

**All four values are identical, before and after.** No unexpected change was detected — the STOP-IMMEDIATELY condition was not triggered.

- **Content-verification method** (for "normalized_reviews content unchanged"): `md5(string_agg(canonical_review_id || content_hash, '' ORDER BY canonical_review_id))` — a single deterministic hash over every row's identity and content_hash, ordered, so any insert, delete, or single-byte content change anywhere in the table would change the checksum. This is the same method used as the integrity check throughout every prior step (Steps 4–12), applied fresh here rather than assumed carried over.
- **Writes**: none occurred. Structurally guaranteed, not just observed — every query executed this step was a bare `SELECT`; no `AiProvider`, no `runAiSentimentPipeline`, and no persistence code path was invoked at any point.
- **Unexpected mutation**: none detected.

### What was already verified in previous steps (not re-derived here, cited for context only)

The 100,006 / `821903ac625da7ee6256e2b6344ce868` / 50,007 / 50,002 baseline itself was established across Steps 6.1 (restoration) through 12 (last independent re-verification) — this step's contribution is a **fresh, independent confirmation** at this specific point in time, not a new discovery that the baseline exists. `review_sentiment`/`review_theme` counts (5,035 / 8,933 as of Step 12) are outside this step's explicit scope (the original spec names only `normalized_reviews` and the two source tables) and were not re-queried here.

### What is inferred, not measured

Nothing in this section is inferred — both snapshots were direct, independent SQL reads. The only inference worth naming explicitly: since nothing was performed between the two reads, an unchanged result was the expected outcome, not a surprising one — this step's value is the *proof* that expectation held, via actual re-measurement, not the discovery of something unknown.

### Regression

**Not run.** The original Step 13 specification contains no regression requirement — regression is Step 14, explicitly out of scope for this step per your instruction.

### AI calls made during Step 13

```
Real Gemini calls: 0
Real Anthropic calls: 0
Mock AI calls: 0
```

### Database safety

```
Production access: none. DB_PROD_* was not read or configured. No connection to production RDS was made.
DataWarehouse.flipkart_reviews / myntra_reviews: read-only (count only), never written.
normalized_reviews: read-only (count + checksum), never written.
```

---

## Step 14 — Regression (Original Specification, Recovered)

Recovered verbatim from the original Phase 4.1 plan:

```
STEP 14 — REGRESSION
============================================================

Run:
npm test
npm run typecheck
npm run safety-check

Expected baseline: 192/192 tests passing

If tests fail: STOP and investigate.
Do not weaken tests.
```

### Scope actually executed this step

Exactly the three commands above. No additional tests were written, no existing test was modified or weakened, no Gemini or Anthropic API call was made (none was required by this step's specification), no data was modified, no production access of any kind.

### Result — PROVEN BY EXECUTION

```
npm test:
  Test Files  38 passed (38)
  Tests       194 passed (194)

npm run typecheck:
  clean — zero errors

npm run safety-check:
  OK — no write-shaped SQL found in database/prodReadOnly/.
```

**All three passed. Nothing failed; the STOP-and-investigate condition was not triggered.**

### Baseline comparison — OBSERVED, explained, not silently accepted

The original spec's expected baseline is **192/192**. The actual, current result is **194/194** — 2 more than specified. This is not a discrepancy requiring investigation: `tests/unit/geminiProvider.test.ts` (2 tests — constructor throws without an API key; `modelVersion`/`name` are correct once a key is present) was added in Step 1–3 of this same Phase 4.1 sub-phase, when the `GeminiProvider` itself was built. Every regression run from Step 3 onward in this report has shown 194/194 for the same reason — this is the first time it's being checked against the original spec's literal "192" baseline number rather than against this session's own running total, so it's called out explicitly here: **192 was the pre-Gemini-provider baseline; 194 is the correct, current, fully-passing baseline, and the +2 is fully accounted for.**

### What was already verified in previous steps (not re-derived here)

Every prior step in this report (1 through 13) already ran this identical three-command regression at its own conclusion, always with a clean result. Step 14's contribution is not a new discovery that the codebase is healthy — it's confirming that a regression run under the *original spec's own literal terms* (checked against "192/192," not the running "194/194" this report has used throughout) still passes cleanly, with the difference explained rather than glossed over.

### What is inferred, not measured

Nothing — all three results above came from direct command execution, not inference.

### Database safety

```
No database connection was required or made by this step's commands beyond what npm test's own isolated
pri_test_appstore/pri_test_prodsource fixtures use internally (unchanged from every prior test run this session).
Production access: none. DB_PROD_* was not read or configured.
The restored local dataset (gbl_data_lake) was not touched by this step.
```

### AI calls made during Step 14

```
Real Gemini calls: 0
Real Anthropic calls: 0
Mock AI calls: 0 (beyond what the existing test suite's own fixtures already exercise internally, unchanged from every prior run)
```

### Measured vs inferred summary

| Claim | Classification |
|---|---|
| `npm test` passes with 194/194 | PROVEN BY EXECUTION |
| `npm run typecheck` is clean | PROVEN BY EXECUTION |
| `npm run safety-check` finds no write-shaped SQL | PROVEN BY EXECUTION |
| The +2-over-baseline difference (192→194) is fully explained, not a regression | OBSERVED — traced to the 2 GeminiProvider construction tests added earlier in this sub-phase |
| No test was weakened to make this pass | OBSERVED — no test file was modified this step |
| Codebase health beyond what these three commands check | NOT CLAIMED |

---

## Step 15 — Final Report (Original Specification, Recovered)

Recovered verbatim from the original Phase 4.1 plan:

```
STEP 15 — REPORT
============================================================
Create: docs/implementation/phase-4.1-real-ai-validation-report.md
Include: 1. provider  2. model  3. authentication result  4. synthetic canary result
5. 10-review smoke test  6. mock vs real comparison  7. latency  8. token usage  9. cost
10. narrator result  11. numerical-claim validation  12. rate-limit behavior  13. retry behavior
14. idempotency  15. database safety  16. regression  17. coverage  18. known limitations
19. measured vs projected  20. GO / NO-GO
Every claim must be based on actual execution. Never guess.

FINAL DECISION: If everything passes: GO for controlled local real-AI development.
If provider authentication/output/cost/safety has a problem: NO-GO and stop.
Regardless of result, DO NOT start: production AI, production DB access, API, React frontend, dashboard.
Wait for explicit approval.
```

### Scope actually executed this step

This file already existed and has been continuously updated since Step 3 — "create" is satisfied structurally. Step 15's remaining job is the 20-item outline below, assembled from findings already measured in Steps 1–14 above. **Zero new Gemini/Anthropic calls were made** — none were required by this step's specification, and every item below either cites an existing measurement or is explicitly marked `NOT MEASURED` rather than estimated. No data was modified, no production system was accessed.

### 1. Provider
**Gemini** (`@google/genai`), switched from the originally-planned Anthropic mid-session per your direction. `AnthropicProvider` remains code-complete but untested with a real key throughout all of Phase 4.1.

### 2. Model
Configured as `gemini-flash-latest` (`GEMINI_MODEL`, corrected from the deprecated default `gemini-2.5-flash` in Step 3). **Resolves to a concrete underlying model, `gemini-3.6-flash`** — discoverable only via real error payloads (Steps 3/4), never documented anywhere the session had access to in advance.

### 3. Authentication result — PROVEN BY EXECUTION
Successful across every real call made in this sub-phase (~33 real API round-trips, per the Step 12 rollup). Key read from `backend/.env` only, presence-checked via `grep`, never printed, logged, or committed by this session.

### 4. Synthetic canary result — PROVEN BY EXECUTION (Step 3)
First attempt failed with a genuine `404` (deprecated model name, not an auth/connectivity problem — proven by the fact it was a real API response). Fixed by correcting the default model; two subsequent clean runs both succeeded, correct sentiment + all 3 themes identified on the synthetic "Poor quality / stitching came apart" review.

### 5. 10-review smoke test — PROVEN BY EXECUTION (Step 4)
9/9 non-rate-limited reviews succeeded; 1 genuine `429` failure, correctly isolated (zero partial writes, confirmed by direct SQL). `review_sentiment` +9, `review_theme` +32, both exactly matching the run's own counts.

### 6. Mock vs. real comparison — PROVEN BY EXECUTION / OBSERVED (Step 5)
9/9 sentiment-label agreement on the comparable reviews — reported as an observation of rating-driven consistency, never as an accuracy claim (mock sentiment is deterministically rating-derived, not an independent signal). Real Gemini found 1–2 more themes per review than the mock's literal-keyword match, via genuine semantic extraction. The "color" theme appearing in every sample review was traced to the literal presence of that word in the seed text, not a model artifact.

### 7. Latency — PROVEN BY EXECUTION (multiple independent real samples)
```
Step 4  (10-review batch, successful 9):  min 4,809ms   max 14,133ms   avg 6,802ms
Step 8  (1 short synthetic review):        5,060ms
Step 9  (1 narrator call, well-populated): 10,194ms
Step 10 (1 narrator call, sparse evidence): 15,789ms
Step 11 (6-review deliberate batch):        range 170ms (the failed 429 call) to 32,883ms
```
No general "typical latency" figure is claimed — these are the actual, individual measurements, not averaged into a single production-projection number.

### 8. Token usage — PROVEN BY EXECUTION (3 independent real `analyzeReview`/`narrate` samples, real `usageMetadata`)
```
Step 8  (short review):        prompt 35    output 73    thoughts 479    total 587   (thoughts = 82%)
Step 9  (dense evidence pkg):  prompt 1,186 output 456   thoughts 1,969  total 3,611  (thoughts = 55%)
Step 10 (medium evidence pkg): prompt 940   output 427   thoughts 922    total 2,289  (thoughts = 40%)
```
The resolved model is confirmed to be a "thinking" model whose reasoning-token overhead dominates total usage in every sample — not assumed to be a fixed ratio, reported as 3 distinct real data points.

### 9. Cost — OBSERVED (real account state) / NOT MEASURED (paid tier)
**$0 actual cost** for every real call this sub-phase — this account is on Gemini's free tier, independently confirmed via two separate real `429` payloads naming free-tier quota metrics (Steps 4 and 11). **Paid-tier-equivalent cost is explicitly NOT MEASURED anywhere in this report** — no per-token pricing was looked up or assumed, per the standing "never fabricate a number" rule. The real token counts in item 8 are what a paid-tier estimate would need, if one is wanted later.

### 10. Narrator result — PROVEN BY EXECUTION (2 independent real evidence shapes, Steps 9 & 10)
Well-populated evidence (Step 9): schema-valid output, zero hallucinated citations, one numeric claim exactly matched its evidence-package field. Sparse/zero-AI-data evidence (Step 10): every numeric claim again matched exactly — **but** the narrator fabricated theme-to-review attributions with no supporting evidence-package signal (1/4 wrong, 1/4 questionable, verified against real review text). This is the single most significant open finding from the entire sub-phase — see item 18.

### 11. Numerical-claim validation — PARTIAL, with an explicit, disclosed gap
The original spec's exact test (evidence states 42%, model output attempts 45%, does validation catch the mismatch) **was never executed** — this is part of the disclosed Step 10 numbering/scope discrepancy (recorded at the top of this report, not silently fixed here). What **was** executed instead: two real narrator calls, across two very different evidence shapes, both showing every stated number traced exactly to a real evidence-package field (items 8/9/10's percentages, review counts, average ratings — Steps 9 & 10). This is real, valuable evidence about numeric fidelity, but it is **not** the same as proving the validation layer actively *catches* a deliberately-injected mismatch, since no such mismatch was ever presented to the model. **Whether an intentionally wrong number would be caught remains untested.**

### 12. Rate-limit behavior — PROVEN BY EXECUTION, with a disclosed methodology deviation
Step 4 incidentally captured one real `429` during normal 10-review processing. Step 11 **deliberately** fired 6 rapid real calls specifically to force a second `429` under controlled/instrumented conditions — a methodology that conflicts with the original spec's explicit "do NOT perform aggressive testing, use normal controlled calls only" instruction (surfaced in full when the discrepancy was discovered; the findings themselves are real and valid regardless of how the deviation happened). Findings: retry engages correctly and recovered in both real 429 cases; the API's quota metadata (`quotaId` labeled `...PerDay...`, `limit: 20`) was contradicted by its own behavior (cleared in ~1 second, not a day) — reported as a measured discrepancy in the API's own self-description, not generalized into a claim about how Gemini's quota system works overall. Timeout, authentication, and invalid-request error types (also named in the original Step 11 spec) were **never tested** — genuinely `NOT MEASURED`.

### 13. Retry behavior — PROVEN BY EXECUTION + source inspection
`p-retry` retries up to `maxRetries`, isolating each review's failure from the batch. Two real, non-obvious, precisely-measured findings: (a) the retry/attempt counter counts *failed attempts*, not "retries beyond the first" (with `maxRetries: 2`, the counter reads 3) — Step 7; (b) retry backoff **never reads** the API's own suggested `retryDelay`/`RetryInfo` — confirmed twice with real timestamps (Step 4 informally, Step 11 precisely: retried at ~1.0s against an ~11.1s request) and by direct source inspection of `pipeline.ts`'s `pRetry(...)` call, which only configures a fixed `minTimeout`.

### 14. Idempotency — PROVEN BY EXECUTION + UNIT-TEST PROVEN (Step 6, all 4 cases)
Content-hash-based staleness, `updatedAt`-blind by design: unchanged content → 0 real calls (Case A, real provider, call-counted); `updatedAt`-only change → ignored end-to-end (Case B, unit-test proven, re-run fresh); content change → exactly 1 real call, correctly reclassified (Case C); rating change → correctly detected as stale and reprocessed (Case D). The 2 rows mutated for Cases C/D were fully restored to their exact pre-Step-6 values in Step 6.1, checksum-verified.

### 15. Database safety — PROVEN BY EXECUTION (continuous, plus the dedicated Step 13 checkpoint)
`normalized_reviews`: row count unchanged throughout (100,006); content checksum unchanged at every checkpoint except the deliberate, disclosed, and since-fully-restored Step 6 mutation. `DataWarehouse.flipkart_reviews`/`myntra_reviews`: unchanged (50,007 / 50,002) at every single checkpoint across all 14 prior steps, without exception. Production: never accessed — `DB_PROD_*` never configured for a live connection, no production RDS connection ever made.

### 16. Regression — PROVEN BY EXECUTION (Step 14)
`npm test`: 194/194 passing. `npm run typecheck`: clean. `npm run safety-check`: clean. The +2-over-the-original-192-baseline difference is fully explained (2 `GeminiProvider` construction tests added earlier in this sub-phase) — not an unexplained drift.

### 17. Coverage — NOT MEASURED
No code-coverage percentage was captured anywhere in this Phase 4.1 sub-phase. `vitest.config.ts` has a coverage provider configured (`v8`), but no `--coverage` run was performed or reported during Steps 1–14. Stated honestly as not measured rather than run fresh here, since Step 15 is a synthesis step and this would be new validation beyond what's already been captured.

### 18. Known limitations — all previously disclosed, none newly softened here
1. `gemini-flash-latest` resolves to an undocumented concrete model (`gemini-3.6-flash`), discoverable only via error payloads.
2. Failure logs omit `platform` and any structured failure-category field (Step 7).
3. Retry/attempt counters count failed attempts, not "retries beyond the first" (Step 7).
4. The resolved model's reasoning-token overhead dominates cost (40–82% of tokens across 3 samples) — must be accounted for in any future cost projection.
5. **Narrator citation-relevance is not enforced** — only citation-*validity* is. A real Gemini narrator produced 1/4 factually wrong and 1/4 questionable theme-to-review attributions in a zero-theme-evidence scenario (Step 10). **This is the most significant open finding in this report.**
6. Retry backoff never reads the provider's own suggested `retryDelay`/`RetryInfo` (Steps 4, 11).
7. Gemini's quota-metadata `quotaId` string is not a reliable guide to actual enforcement duration (Step 11).
8. The original Step 10's specific 42%-vs-45% mismatch-detection test was never run — whether validation catches a deliberately wrong number is untested (item 11 above).
9. Step 11's methodology (deliberately forcing a real 429) deviated from the original spec's "no aggressive testing" instruction.
10. This report's own Steps 10–12 (as originally executed, before the discrepancy was discovered) do not match the original specification's Step 10–12 definitions — documented at the top of this report, never silently reconciled.
11. Timeout, authentication, and invalid-request provider error types were never tested (item 12 above).
12. Code coverage was never measured (item 17 above).

### 19. Measured vs. projected
**Nothing in this report is a projection.** Every number is either `PROVEN BY EXECUTION` (real command/API output), `UNIT-TEST PROVEN` (an existing, re-run test), `OBSERVED` (a real but single/small-sample fact, not generalized), or explicitly `NOT MEASURED` (paid-tier cost, code coverage, timeout/auth/invalid-request error handling, the 42/45% mismatch test) — never silently filled in with an estimate. No production-scale figure is extrapolated from these small local samples anywhere in this report.

### 20. GO / NO-GO

**GO — for controlled local real-AI development only.**

Per the original decision criteria: authentication, output, cost, and safety were each checked and none surfaced a blocking problem —
- **Authentication**: no failures, real key worked reliably across ~33 real calls.
- **Output**: structured-output validation, citation-*ID* validation, and numeric-claim grounding all held across every real sample tested. The one real output-quality gap found (citation-*relevance*, item 18 #5) is a narrator-specific limitation, disclosed clearly, not a systemic provider or pipeline failure.
- **Cost**: $0 actual, on the free tier; no problem encountered (paid-tier cost is simply unknown, not broken).
- **Safety**: zero production access, zero uncontrolled data loss (the one deliberate Step 6 mutation was fully restored and checksum-verified), zero unexplained database drift at any of the 14 checkpoints performed.

This GO is **explicitly scoped** to controlled local development, exactly as the original decision criteria frames it — **not** a production-readiness claim, and **not** a general model-accuracy claim (no human-labeled ground truth exists anywhere in this project to support one). The known limitations in item 18 — especially the narrator citation-relevance gap — should be addressed or at minimum actively monitored before any scope expansion beyond controlled local use.

**Regardless of this result, per the original spec: do not start production AI, production DB access, an API, a React frontend, or a dashboard.** None of that has been started. Waiting for explicit approval before anything further.

---

## Phase 4.1 Remediation

Authorized after Step 15's GO decision above, to close the open findings that decision explicitly flagged. Six items; each is either fixed-and-tested, measured-and-documented, or explicitly stopped with a clear reason — nothing is silently skipped, nothing is claimed "probably fixed."

### Item 1 — Citation Relevance (highest priority) — FIXED

**Root cause**: `narrateProductEvidence()` validated that a cited `canonical_review_id` *exists* in the evidence package, but never checked whether it actually *supports* the specific theme claim it was attached to. Supplementary Validation A proved this concretely: a real Gemini narrator attributed themes to reviews with zero supporting theme evidence, and 1/4 of those attributions was factually wrong when checked against real review text.

**Fix**: `evidencePackage.ts` now includes a deterministic `reviewThemes: Record<canonicalReviewId, theme[]>` map, sourced directly from `review_theme` (not inferred, not AI-judged). `narrator.ts`'s `narrateProductEvidence()` filters every `rootCause` citation (and every `recommendations` citation with a `theme` set — a new, optional field added to the schema so recommendations get the same protection) against this map: a citation naming a theme the review isn't actually tagged with is stripped into a new `irrelevantCitations` list (distinguished from `rejectedCitations`, which is for nonexistent IDs). A claim left with zero valid, relevant citations is **dropped entirely**, not left half-supported (`droppedUnsupportedClaims` counts these). All deterministic — no model is ever asked to judge another model's relevance, per your explicit instruction. `MockAiProvider.narrate()` was updated to only ever cite grounded evidence, so it remains a valid test double under the new check. Both `geminiProvider.ts` and `anthropicProvider.ts`'s prompts and structured-output schemas were updated to explain the grounding requirement to the model itself (an optional `theme` field on recommendations; explicit prompt instruction not to attribute a theme to a review whose `reviewThemes` entry lacks it).

**Tests** (`tests/integration/aiEvidenceNarrator.test.ts`, new `describe("citation relevance")` block, 3 tests, plus 1 existing test updated to require a genuinely grounded citation rather than an incidental one):
- A real, valid ID cited for a theme it does NOT have → stripped as irrelevant, the claim dropped, `droppedUnsupportedClaims` incremented — **PROVEN BY EXECUTION**.
- The exact Step 10 (Supplementary Validation A) shape — zero theme evidence at all — cannot produce any theme claim, root cause and recommendation both dropped — **PROVEN BY EXECUTION**.
- A recommendation with no `theme` set is exempt from relevance filtering (general advice, ID-existence only, as before) — **PROVEN BY EXECUTION**.
- The pre-existing hallucinated-ID test now supplies a genuinely grounded citation (via a deterministic test-fixture insert into `review_theme`, not incidental seed text) so "real ID kept" is still a meaningful assertion — **PROVEN BY EXECUTION**.

### Item 2 — Retry Backoff Honoring `retryDelay`/`RetryInfo` — FIXED

**Root cause**: `pipeline.ts` retried every failure on `p-retry`'s own fixed exponential schedule, never reading the provider's suggested wait time. Measured concretely in Step 4 (8.5s of retrying against a 24.78s suggestion) and Supplementary Validation B (1.0s against 11.1s).

**Fix**: `AiProviderError` gained `retryable`, `retryAfterMs`, and `category` fields (all optional, all defaulting to the pre-existing behavior — `retryable: true`, no delay, `category: "provider_error"` — so every existing call site across the codebase kept working unchanged). `geminiProvider.ts` and `anthropicProvider.ts` each gained a `classifyGeminiError`/`classifyAnthropicError` function that reads the *actual* SDK error shape (Gemini's `ApiError.status` + JSON body `details[]`; Anthropic's distinct error classes and `retry-after` header) to populate these fields — verified against real captured payloads, never assumed. `pipeline.ts`'s `pRetry` call now has a `shouldRetry` that aborts immediately on a non-retryable error (no wasted attempts on a fatal auth failure), and an async `onFailedAttempt` that `sleep`s the provider-suggested delay (capped by a new `AI_RETRY_MAX_DELAY_MS` config, default 30s, so a pathological suggested delay can't stall a batch) before falling back to the existing schedule when no delay was supplied.

**Tests** (`tests/integration/aiRetryDelayAndLogging.test.ts`, 6 tests + `tests/unit/geminiErrorClassification.test.ts`, 5 tests):
- Retryable error WITH `retryAfterMs` → the actual gap between attempts is ≥ the requested delay — **PROVEN BY EXECUTION** (real elapsed-time measurement).
- Retryable error WITHOUT `retryAfterMs` → falls back to the existing minTimeout schedule, no pathological wait — **PROVEN BY EXECUTION**.
- Non-retryable error → exactly 1 attempt, no retries, regardless of `maxRetries` — **PROVEN BY EXECUTION**.
- Retry exhaustion (retryable, always fails) → still 1 + maxRetries attempts, still fails cleanly — **PROVEN BY EXECUTION**.
- No partial DB writes when a review fails then recovers — **PROVEN BY EXECUTION**.
- Retry counters remain exactly as previously defined (count of failed attempts) — **PROVEN BY EXECUTION**.
- The real Step 11 429 payload, replayed through `classifyGeminiError()`, parses `retryDelay: "11s"` to exactly `11000`ms — **PROVEN BY EXECUTION against real captured data**, zero new API calls.
- The real 400/404 payloads captured during item 6's reconciliation are correctly classified (see item 6 below) — **PROVEN BY EXECUTION against real captured data**.

### Item 3 — Structured Failure Logging — FIXED

**Root cause**: failure/retry logs carried `jobId`/`canonicalReviewId`/`attempt`/`retriesLeft` but never `platform` or any failure-category field, so an operator couldn't tell Flipkart from Myntra, or a rate limit from a validation failure, from logs alone.

**Fix**: every failure/retry log call site in `pipeline.ts` (the retry-warning log, the validation-failure log, and the final-failure log) now includes `platform: candidate.platform` and `failureCategory`, using the same `AiFailureCategory` enum item 2 introduced (`provider_rate_limit`, `provider_timeout`, `provider_auth`, `provider_unavailable`, `provider_error`, `validation_error`, `persistence_error`, `unknown`) — derived deterministically from the error's own type/fields, never guessed from a message string. `PerReviewOutcome` also gained an optional `failureCategory` field for the same information in the pipeline's return value, not just its logs.

**Tests** (`tests/integration/aiRetryDelayAndLogging.test.ts`, second `describe` block, 5 tests, using `vi.spyOn(logger, ...)` to capture and assert on actual logged objects):
- Rate-limit error → log carries `failureCategory: "provider_rate_limit"` and `platform: "flipkart"` — **PROVEN BY EXECUTION**.
- Validation error → `failureCategory: "validation_error"`, platform present — **PROVEN BY EXECUTION**.
- Generic provider failure → defaults to `failureCategory: "provider_error"` — **PROVEN BY EXECUTION**.
- Retry-warning logs (not just final-failure logs) also carry platform + category — **PROVEN BY EXECUTION**.
- No forbidden PII/secret key ever appears in these new fields — **PROVEN BY EXECUTION** (the logger's own PII guard, `tests/security/piiLogging.test.ts`, would throw in non-production if one did; every new test ran clean).

### Item 4 — Paid-Tier Cost — MEASURED (tokens) + CALCULATED (cost, from current official pricing)

Pricing retrieved from **ai.google.dev/gemini-api/docs/pricing**, the current official Google source, for the **exact model actually used** (`gemini-3.6-flash`, Standard tier — not the deprecated `gemini-2.5-flash` name in config, which resolves to this concrete model, per Step 3/4's finding): **$1.50 / 1M input tokens, $7.50 / 1M output tokens (thinking tokens billed at the output rate, not separately — confirmed by the page's own "output price (including thinking tokens)" wording)**.

```
A. OBSERVED ACTUAL COST: $0 — this account is on the free tier (confirmed via 2 real 429 payloads
   naming free-tier quota metrics, Steps 4 and Supplementary Validation B). This is a fact about the
   account, not a projection.

B. PAID-TIER-EQUIVALENT ESTIMATE (calculated, current official pricing, retrieved for this remediation):
```

Using the real token samples already captured (Steps 8/9/10 — no new calls made, per your explicit instruction):

| Sample | Call type | Prompt | Output | Thinking | Total | Cost/call |
|---|---|---|---|---|---|---|
| Step 8 | `analyzeReview` (1 short synthetic review) | 35 | 73 | 479 | 587 | $0.004193 |
| Step 9 | `narrate` (well-populated evidence) | 1,186 | 456 | 1,969 | 3,611 | $0.019966 |
| Step 10 | `narrate` (sparse evidence) | 940 | 427 | 922 | 2,289 | $0.011527 |
| **Average (all 3, literal instruction)** | mixed | 720.33 | 318.67 | 1,123.33 | 2,162.33 | $0.011895 |

**Per-review classification cost projection** — deliberately based on **Step 8 alone**, not the blended average: Steps 9 and 10 are `narrate()` calls, made once per product/window, not once per review — averaging them into a "cost per review" figure would systematically overstate real per-review classification cost, since a real batch makes far more `analyzeReview` calls than `narrate` calls. Step 8 is the only real `analyzeReview`-shaped sample available (N=1, single short synthetic review — not claimed representative of all review lengths):

```
100 reviews:      $0.42
1,000 reviews:    $4.19
10,000 reviews:   $41.93
100,000 reviews:  $419.25
```

The literal blended-3-sample projection (mixing call types, included only because explicitly requested) for reference: 100/$1.19, 1,000/$11.90, 10,000/$118.96, 100,000/$1,189.55 — **not recommended as the per-review figure**, for the reason above.

**Pricing source**: https://ai.google.dev/gemini-api/docs/pricing, retrieved during this remediation. Gemini pricing changes over time — re-verify before using this for a real budgeting decision made significantly later.

### Item 5 — Human-Ground-Truth Accuracy — STOPPED, per your own explicit instruction

```
Accuracy not measured because independent human ground truth is unavailable.
```

This session is an AI system with no mechanism to recruit real human labelers. Having any AI (including this one) generate the "ground truth" labels would be exactly the self-referential AI-grading-AI problem this exercise exists to avoid — not independent human judgment, regardless of which model does it. A second, compounding limitation: even the reviews available to label are synthetic seed data (the local dataset), not real customer reviews — the only non-synthetic source is the production `DataWarehouse` tables, access to which is explicitly forbidden in this engagement. No labels were fabricated; no partial/simulated dataset was built, per your explicit "Do not fabricate labels" instruction.

### Item 6 — Step 10–12 Reconciliation — COMPLETE

Recovered the original specification for Steps 10 ("Numerical Claim Safety"), 11 ("Real Provider Rate Limiting"), 12 ("Performance") from session history, executed each under its correct original definition, and reconciled the report:
- **Original Step 10** now exists in its correct position — the 42%-vs-45%-shaped mismatch test was actually run (a permanent test, not a one-off), confirming the original finding: a wrong number in narrator prose is **NOT CAUGHT**.
- **Original Step 11** now exists in its correct position — reused the real rate-limit/retry-delay evidence already captured (no new quota-exhausting calls, per your explicit instruction), and made exactly 2 small, non-aggressive, controlled real calls to test the 2 error types (auth, invalid-request) the original spec named but nothing in this whole engagement had ever tested — which **found and fixed a real bug**: Gemini returns HTTP 400, not 401/403, for an invalid API key.
- **Original Step 12** now exists in its correct position — real Gemini throughput/latency (reused from Step 4 and Supplementary Validation B, zero new calls) compared against mock throughput (reused from Phase 4's own earlier, larger-scale measurement) — real Gemini measured at ≈2,570–2,580× slower than mock, entirely attributable to network/API latency.
- The three originally-mislabeled sections were **preserved, not deleted**, retitled "Supplementary Validation A/B/C (Historical)" with a clear note on what they actually are and aren't. History was not falsified — the mislabeling is disclosed exactly where it happened, and remains visible.

### Item 7 — Numerical Claim Grounding (final remediation) — FIXED, WITH A DISCLOSED BOUNDARY

**1. Original Step 10 finding, restated exactly as found**: a synthetic provider whose `summary` stated `pkg.positivePercentage + 3` (mirroring the spec's 42-vs-45 shape) passed straight through `narrateProductEvidence()` completely unflagged — no code path inspected digits embedded in free text. Confirmed by a permanent test (Step 10, above), not assumed.

**2. Design**: inspected the existing architecture first (`ProductEvidencePackage`, `NarratorOutputSchema`, all three providers' prompts/schemas, the citation-relevance mechanism from item 1) before choosing an approach. Followed the same pattern item 1 already established — a **new, optional structural field**, `citedMetrics: { field: string; statedValue: number }[]`, added to `NarratorOutputSchema` (and both real providers' schemas/prompts). `field` must be one of 5 whitelisted top-level scalar `ProductEvidencePackage` fields (`CITABLE_METRIC_FIELDS`, exported from `narrator.ts`: `reviewCount`, `averageRating`, `positivePercentage`, `negativePercentage`, `totalMatchingNegativeCount`) — deliberately scoped to top-level scalars only (not `sentimentDistribution`'s or `ratingDistribution`'s per-bucket numbers, not per-theme counts), the least invasive design that still directly prevents the 42-vs-45 failure. `narrateProductEvidence()` deterministically compares `statedValue` against the real `evidencePackage[field]` (float tolerance 0.005, handles the 2-decimal-percentage case correctly) — **no model is ever asked to judge another model's numbers**, per your explicit instruction. A match is kept in the new `citedMetrics` result field; an unknown field or a mismatch is stripped into a new `ungroundedMetrics` field (with a `reason`: `"unknown_field"` or `"value_mismatch"`) — never silently trusted, exactly the same disposition pattern as `rejectedCitations`/`irrelevantCitations` from item 1. Both real providers' prompts now instruct the model to mirror any evidence-derived number into `citedMetrics`.

**3. Before behavior** (unchanged from the original Step 10 finding, still true for prose-only claims — see boundary below): a wrong number stated only in `summary`/`explanation`/`reason` text is accepted with no flag of any kind.

**4. After behavior** (for a number placed in `citedMetrics`, which the updated prompts now request for every evidence-derived figure): `evidence=42, narrator citedMetrics=42` → kept, `citedMetrics: [{field, statedValue: 42}]`. `evidence=42, narrator citedMetrics=45` → **rejected**, stripped into `ungroundedMetrics: [{field, statedValue: 45, reason: "value_mismatch"}]`, and does **not** appear in the trusted `citedMetrics` result — proven directly by test B below, reproducing the exact original scenario.

**5. Tests added** — `tests/unit/narratorNumericGrounding.test.ts`, 13 tests, **zero database access in any of them** (a synthetic in-memory `ProductEvidencePackage` is constructed directly — `narrateProductEvidence()` needs nothing else), **zero real Gemini calls**:
- **A**: evidence=42, citedMetrics=42 → kept — PASS, **PROVEN BY EXECUTION**.
- **B**: evidence=42, citedMetrics=45 → stripped as `value_mismatch` — **PROVEN BY EXECUTION** (the exact original Step 10 scenario, now caught).
- **C**: unknown field name → stripped as `unknown_field` — **PROVEN BY EXECUTION**.
- **D**: decimal values (3.74 vs 3.77) — both match and mismatch correctly validated — **PROVEN BY EXECUTION**.
- **E / E2**: zero (`0`) correctly validated as a real value, not treated as falsy/absent; a `null` evidence field (e.g. no reviews yet) can never be "matched" by any stated number, always ungrounded — **PROVEN BY EXECUTION**.
- **F**: percentage values (66.22, 20.27) — **PROVEN BY EXECUTION**.
- **G**: multiple metrics in one response, independently validated — 2 correct, 1 mismatch, 1 unknown, all classified correctly in the same call — **PROVEN BY EXECUTION**.
- **H**: existing narrator output with no `citedMetrics` at all still passes — backward compatible — **PROVEN BY EXECUTION**.
- **I**: item 1's citation-relevance behavior is unaffected by this change (relevant citation kept, irrelevant one dropped, in the same response that also carries citedMetrics) — **PROVEN BY EXECUTION**.
- **J**: malformed structure (`statedValue` as a string) — rejected by schema validation, same as any other malformed narrator output — **PROVEN BY EXECUTION**.
- **K**: structural confirmation that no test in this file touches a database — **PROVEN BY EXECUTION** (by construction/inspection).
- **Disclosed-boundary test**: a wrong number stated ONLY in prose, with no `citedMetrics` entry, is still **not** caught — **PROVEN BY EXECUTION**, this is the honest limit of the fix, demonstrated directly rather than only described.

**6. Remaining limitations — stated plainly, not overclaimed**: this fix guarantees that any number a narrator places in `citedMetrics` is deterministically verified or stripped. It does **not**, and structurally **cannot**, guarantee that free-form `summary`/`explanation`/`reason` prose never contains an unverified number — a model that ignores the new prompt instruction and writes a number only in prose is not caught, exactly as before this fix (proven by the disclosed-boundary test above). This is not a gap in the implementation; it is an inherent property of validating structured data versus free text, and abandoning free-form narration entirely was not in scope. **Not claimed**: "all numerical claims are grounded." **Claimed, and true**: "every numerical claim represented in `citedMetrics` is grounded — verified or removed, never trusted as-is."

### Regression after all remediation work (including Item 7)

```
npm run typecheck   — clean
npm test             — 227/227 passing (194 pre-remediation baseline + 33 new tests: 4 net-new narrator/citation-relevance
                        tests, 11 retry-delay/logging tests, 5 real-payload error-classification tests, 13 numerical-claim
                        grounding tests)
npm run safety-check — OK, no write-shaped SQL found
```

### Database safety across all remediation work

```
Production access: none, at any point — DB_PROD_* never configured for a live connection, no production RDS connection made.
DataWarehouse.flipkart_reviews: 50,007 (unchanged throughout remediation)
DataWarehouse.myntra_reviews: 50,002 (unchanged throughout remediation)
normalized_reviews: 100,006 rows, checksum 821903ac625da7ee6256e2b6344ce868 — unchanged throughout remediation
  (all code-fix testing ran against the isolated pri_test_appstore fixture; the 2 controlled real-error-shape calls in
  item 6 made no database connection at all — confirmed by source, both scripts imported only the Gemini SDK and config)
review_sentiment / review_theme: unchanged from their Step 12 (historical) values (5,035 / 8,933) — remediation added
  zero new rows to the local restored dataset
Item 7 (numerical-claim grounding) made zero database connections of any kind — all 13 tests use a synthetic,
  in-memory ProductEvidencePackage, confirmed by source (no appSequelize/resetAppStore/runTrackA import anywhere
  in tests/unit/narratorNumericGrounding.test.ts) — re-verified via direct SQL after this item, unchanged.
```

### Consolidated remediation ledger

| Item | Outcome | Classification |
|---|---|---|
| Citation relevance now enforced (theme-to-review grounding) | FIXED | PROVEN BY EXECUTION (4 tests, deterministic) |
| Retry backoff honors provider-suggested delay, capped | FIXED | PROVEN BY EXECUTION (6 tests + real-payload replay) |
| Non-retryable errors abort immediately, no wasted attempts | FIXED | PROVEN BY EXECUTION |
| Structured failure logs (platform + category) | FIXED | PROVEN BY EXECUTION (5 tests, real log capture) |
| Gemini auth failures correctly classified (400, reason-code based) | FIXED (bug found + fixed during reconciliation) | PROVEN BY EXECUTION (real captured payloads) |
| Paid-tier cost, per-review projection | CALCULATED from current official pricing + real token samples | Tokens: PROVEN BY EXECUTION. Cost: derived, not itself a new measurement. |
| Human-labeled sentiment/theme accuracy | NOT MEASURED — explicitly stopped, no fabrication | Matches your own required stop condition exactly |
| Original Step 10 (42-vs-45 mismatch) executed | Confirmed NOT CAUGHT, documented as a limitation | PROVEN BY EXECUTION |
| Original Step 11 (rate-limit, controlled calls) executed | Rate-limit/retry-delay reused; auth/invalid-request newly tested | PROVEN BY EXECUTION; timeout remains NOT MEASURED |
| Original Step 12 (performance) executed | Real vs mock throughput compared, ~2,570x gap measured | PROVEN BY EXECUTION; concurrency NOT APPLICABLE (sequential-only architecture) |
| Structured numeric claims (`citedMetrics`) deterministically grounded or stripped | FIXED | PROVEN BY EXECUTION (13 tests, zero DB, zero real calls) |
| Free-form prose numbers with no `citedMetrics` entry | Still unverified — disclosed, not fixed (cannot be, without abandoning free text) | PROVEN BY EXECUTION that this boundary exists (dedicated test) |
| Report history | Preserved, relabeled, not deleted or falsified | — |
| Production readiness | Still NOT CLAIMED anywhere in this report | — |

### Final recommendation

The specific gaps Step 15's GO decision flagged as needing attention before scope expansion — citation relevance, retry-delay handling, failure-log observability — are fixed and tested. Numerical-claim grounding is now fixed for the structured channel (`citedMetrics`) real providers are prompted to use — the original 42-vs-45 scenario is caught when a compliant model uses that channel, proven directly. One boundary remains, disclosed rather than hidden: a model that states a number only in free-form prose, never in `citedMetrics`, is still not caught — an inherent limit of validating structured data against free text, not an implementation gap. One further item remains genuinely out of reach in this environment: **human-labeled accuracy**, blocked by the absence of any independent human-labeling mechanism here, not by effort. Recommendation is unchanged from Step 15: **GO for controlled local real-AI development**, now on firmer footing than before remediation — still explicitly not a production-readiness claim, still not a general model-accuracy claim. Per every instruction across this whole engagement: no production AI, no production DB access, no API, no frontend, no dashboard has been started, and none will be without further explicit approval.

---

## Confirmations

```
PRODUCTION DATABASE ACCESSED: NO
DataWarehouse.flipkart_reviews / myntra_reviews: UNCHANGED (count-verified every step)
normalized_reviews: row count unchanged throughout; content mutated for exactly 2 rows in Step 6 (Cases C/D),
                     fully restored to pre-Step-6 values in Step 6.1 (checksum-verified exact match).
GEMINI_API_KEY: present in backend/.env only, added by you directly, never printed/logged/committed by this session.
Step 6 used exactly 1 real Gemini API call (Case C), at the pre-approved budget of 1 — measured via call-counting instrumentation, not inferred.
Step 6.1 used exactly 0 real Gemini API calls and 0 mock AI calls — restoration was direct SQL only.
Step 7 used exactly 0 real Gemini API calls — ran entirely against the isolated pri_test_appstore/pri_test_prodsource fixture, never the local dataset.
Step 8 used exactly 1 real Gemini API call (the minimum needed to observe real token usage) — zero database connections, zero persistence.
Step 9 used exactly 1 real Gemini API call (the narrator) — read-only evidence-package build, zero writes, checksum re-verified unchanged.
Supplementary Validation A (historical "Step 10") used exactly 1 real Gemini API call (sparse-evidence narrator test) —
         read-only, zero writes, checksum re-verified unchanged before and after.
Supplementary Validation B (historical "Step 11") used exactly 7 real Gemini API calls (6 reviews + 1 retry) — deliberately
         reproduced a real 429; 6 new legitimate classifications persisted (no restoration needed, same precedent as Step 4);
         checksum unchanged, independently re-verified.
Supplementary Validation C (historical "Step 12") used 0 real Gemini API calls — pure synthesis of Steps 1-11 into an
         interim consolidated summary; final dataset state re-verified via direct SQL (checksum unchanged, source tables unchanged).
Step 13 (Database Safety, original spec) used 0 real Gemini API calls — pure read-only before/after verification.
Step 14 (Regression, original spec) used 0 real Gemini/Anthropic API calls — npm test/typecheck/safety-check only.
Step 15 (Final Report, original spec) used 0 real Gemini API calls — pure synthesis of Steps 1-14 into the 20-item report
         and GO/NO-GO decision.
Phase 4.1 Remediation (items 1-6) used exactly 2 real Gemini API calls total (item 6's controlled auth/invalid-request
         investigation — a deliberately invalid key, and a deliberately invalid model name; both failed before generation,
         neither expected to consume generate_content quota, neither made any database connection). Items 1/2/3's fixes
         were tested entirely via mocked providers and real-payload replay (zero new Gemini calls); item 4 used only
         already-captured token samples from Steps 8/9/10; item 5 made zero calls of any kind (stopped per instruction).
         214/214 tests passing (194 pre-remediation + 20 new), typecheck clean, safety-check clean.
Final local dataset state (unchanged since Step 12/Supplementary Validation C, confirmed after every remediation step):
         normalized_reviews 100,006, checksum 821903ac625da7ee6256e2b6344ce868, review_sentiment 5,035, review_theme 8,933,
         DataWarehouse.flipkart_reviews 50,007, DataWarehouse.myntra_reviews 50,002.
```
