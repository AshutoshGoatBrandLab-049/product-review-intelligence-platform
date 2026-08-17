# Phase 4 — AI Review Intelligence Layer — Implementation Report

**Scope:** sentiment classification, controlled theme extraction, evidence-validated narration — all downstream of `normalized_reviews`, never a source of truth for numbers. No API, no frontend built (none was required for testing). Local-only; zero production access (confirmed at the end).

Status vocabulary, per instruction: **MEASURED** / **PROJECTED** / **ASSUMED** / **NOT IMPLEMENTED**.

---

## Pre-work: inspection findings

Confirmed by direct inspection before writing any code: no `ANTHROPIC_API_KEY` exists anywhere in this environment, `@anthropic-ai/sdk` was not installed, `p-retry` was already a Phase 1 dependency never previously used. This determined the whole session's honesty boundary: the Anthropic provider is **code-complete but NOT exercised by any test or local run** — every validation in this report ran against the mock provider, exactly as Step 11 anticipated. Reused rather than rebuilt: canonical ID, `content_hash` staleness mechanism, date windows, confidence thresholds, evidence-reference pattern, `THEME_VOCABULARY`, `logger.ts`'s PII guard, `assertLocalMigrationTarget`, `resetAppStore`/fixture-tagging test conventions.

---

## Architecture

`src/modules/ai/` — `types.ts` (Zod schema), `validation.ts` (schema + business rules), `providers/` (interface, mock, Anthropic, factory), `candidateSelection.ts`, `pipeline.ts`, `evidencePackage.ts`, `narrator.ts`. One combined per-review AI call produces both sentiment and themes together (matches your Step 6 example shape, halves API calls vs. two separate calls per review).

## Provider abstraction

`AiProvider` interface (`analyzeReview`, `narrate`) — `pipeline.ts` and `narrator.ts` depend only on this, never a vendor SDK. `createAiProvider()` reads `config.ai.provider`, **defaulting to `"mock"`** — the application can never start making paid API calls just by booting with an unset `AI_PROVIDER`. `MockAiProvider` is deterministic (rating→sentiment, literal keyword match→themes, no randomness) with an `injectFailures(n)` test hook. `AnthropicProvider` uses tool-use (forced structured output, never free-text parsing) — written correctly per the SDK's documented pattern, **untested** for the reason above.

## Model

`AI_PROVIDER=anthropic` / `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (default `claude-sonnet-5`) — all environment configuration, no hardcoded credentials, `.env.example` carries placeholders only.

## Prompt/schema strategy

Structured output only, via Zod (`AiAnalysisOutputSchema`) and, for the real provider, Anthropic tool-use with a matching `input_schema`. Malformed responses are rejected outright — proven directly: `validateAiOutput(null)`, a bad label, out-of-range confidence, and an unknown theme all fail validation in `aiValidation.test.ts`.

## Sentiment

Written to `review_sentiment` only — `normalized_reviews` was never touched by any Phase 4 code (structurally true: nothing in `src/modules/ai/` imports the `NormalizedReview` model for writing). Every row carries `canonicalReviewId`, `label`, `confidence`, `modelVersion`, `classifiedAt`, `contentHashAtClassification`. **MEASURED at real scale**: 5,020 real sentiment rows written against the local 100K dataset (20 from an initial smoke run + 5,000 from a larger validation batch), all via the mock provider.

## Themes

Written to `review_theme`, controlled vocabulary enforced at the Zod layer (`z.enum(THEME_VOCABULARY)`) — an AI response naming an unlisted theme is rejected, not coerced. Duplicate `(canonical_review_id, theme)` pairs are deduped before insert (`dedupeThemes`, keeps the higher-confidence observation) and structurally prevented by the DB's own unique constraint either way. **MEASURED**: 8,883 real theme rows from the same validation batch.

## Evidence

`buildProductEvidencePackage()` assembles a fully deterministic package (reusing Phase 3's `computeProductAnalytics`/`findEvidence`, plus new sentiment-distribution/top-theme queries) — this is the *only* input the narrator ever receives, never raw reviews. `canonicalReviewIds` capped at 20 per Phase 3's existing evidence pattern, `totalMatchingCount` kept separate. **Verified with real data**: a product with no classified reviews correctly returns `sentimentDistribution: null, topThemes: []` — never fabricated zeros; a product with real classified data correctly reflects it.

## Stale detection

Directly reuses Track B's exact mechanism: `normalized_reviews.content_hash != review_sentiment.content_hash_at_classification` (or `review_theme`'s equivalent) marks a review stale. One function, `summarizeCandidates()`/`findCandidateReviews()`, both new-and-stale together — no separate staleness pass. **Proven at real scale**: after classifying 20 Flipkart reviews, a dry-run correctly showed `candidateCount: 49,984` (exactly 50,004 − 20); an `updatedAt`-only mutation correctly left the candidate pool unchanged; a content/rating mutation correctly made the review a candidate again.

## Batch processing

Configurable `batchSize` (candidate-fetch granularity) and a separate `totalLimit` (total-cap for controlled small runs, Step 23) — these are deliberately different knobs. Retries use `p-retry` (exponential backoff, `minTimeout` configurable — set low in tests so the suite stays fast, default 1000ms for real use) with a bounded `maxRetries`. One review's failure is caught and logged individually; the batch continues — **proven**: a batch of 3 with a deliberately-failing 2nd review produced `successCount: 2, failureCount: 1, status: "partial_failure"`, not an aborted run.

## Retry behavior

**MEASURED**: a provider that fails once then succeeds is retried and recorded as a success with `retryCount >= 1`; a provider that always fails is retried exactly `maxRetries` times (bounded, not infinite — confirmed via `callCount === 3` for `maxRetries: 2`) and recorded as `status: "failed"`.

## Idempotency

**MEASURED, twice** — once in the isolated test suite, once at real 100K scale: a second identical run against the same unchanged data produces `candidateCount: 0, processedCount: 0`. Achieved by keyset-paginating the *candidate query itself* (excluding already-classified, non-stale rows) rather than relying on upsert-overwrite alone — a genuinely unnecessary reclassification is never attempted, not just harmlessly repeated.

## Dry-run

**MEASURED**: zero AI calls (proven via a call-counting wrapper provider in `aiPipeline.test.ts`), zero database writes — not even the `ai_processing_runs` audit row, since that would itself be a write. Reports `candidateCount`/`alreadyClassifiedCount`/`staleCount`/`newCount` accurately against real data (`npm run ai:sentiment -- --dry-run`).

## Observability

`ai_processing_runs` — a new, durable audit table (justified here, unlike Phase 3's rebuild, because AI calls cost real money and need a queryable history): `jobId`, `platform`, `provider`, `modelVersion`, dry-run flag, candidate/stale/new/processed/success/failure/retry counts, timestamps, duration, status. Every batch/failure/retry also logs through the existing `logger.ts` — **PII guard reused unchanged**: no review text, no author info, no credentials in any log line (evidence snippets and review bodies are deliberately excluded from every log call in `pipeline.ts`).

## Failure handling

**Structurally proven, not just asserted**: `normalized_reviews` has no write path anywhere in `src/modules/ai/` — a test running an always-failing provider against 3 candidates confirmed every field of every `normalized_reviews` row byte-for-byte unchanged afterward. Partial batch failures don't roll back successful writes in the same batch (each review's classification commits independently, same philosophy as Track A's per-batch commits).

## Cost-control mechanism

`summarizeCandidates()` is the single source of truth for "how many reviews would a real run touch" — computed with zero AI calls. The CLI's `--dry-run` flag makes this the mandatory first step of any real batch (`npm run ai:sentiment -- --dry-run`), and `--total-limit` bounds any real run to an explicit cap rather than defaulting to "everything." **MEASURED**: dry-run against the real 100K dataset completed in 326ms–624ms with zero cost.

## Root-cause / recommendation architecture

The narrator (`narrator.ts`) receives only the evidence package, never raw reviews. Its Zod-validated output cites `evidenceReviewIds` per root-cause/recommendation; every cited ID is checked against the package's own `evidenceReviewIds` — **an ID the model didn't validate is stripped, logged in `rejectedCitations`, and never trusted**. Proven directly with a hand-built "hallucinating" provider: 2 fake IDs were correctly stripped, 1 real ID was correctly kept. Prompt language (both the Anthropic provider's real prompt and this report) uses "Reviews indicate...", "Among the analyzed reviews...", explicitly avoiding unsupported causal claims like sales-driven statements, per your exact guidance.

## Severity boundary

Unchanged from Phase 3's `severity.ts` — `formulaVersion: "severity-v0-not-implemented"`, no formula. Phase 4 introduced no new severity logic.

## Health-score boundary

`ratingScore`/`trendScore` unchanged from Phase 3. **New in Phase 4**: `sentimentScore`/`complaintScore` now compute real values *once validated data exists* for that product/window (proven: both are `null` before any classification, and `sentimentScore` becomes a real 0–100 number immediately after running the pipeline against that product). `severityScore` stays `null` (no formula exists), and **`totalScore` stays `null` even when rating/trend/sentiment/complaint are all available** — deliberately, since not all 5 approved components exist yet. No renormalization, no fake partial total, exactly as instructed.

## Security

No credentials committed — verified `ANTHROPIC_API_KEY` is empty in `.env.example`, never appears in any committed file, and is read only via `config.ai.anthropicApiKey` from environment. The Anthropic provider sends only rating/title/reviewText per review (or the evidence package for narration) — never database internals, never other reviews, never credentials, per Step 5/25.

## Production safety

Unchanged, reconfirmed: zero `DB_PROD_*` access this phase, `DataWarehouse.flipkart_reviews`/`myntra_reviews` read-only throughout (only ever read via the existing Track A/B pipeline to populate `normalized_reviews`, which is what Phase 4 then reads from).

---

## Tests

**192/192 passing** (156 Phase 3 baseline + 36 new: 1 provider-factory + everything below). No existing test was weakened.

| File | Tests | Covers (of your 30 items) |
|---|---|---|
| `aiValidation.test.ts` | 8 | 2, 3, 4, 13, 14, 16, 7(unit) |
| `mockAiProvider.test.ts` | 5 | 1, 17 |
| `aiProviderFactory.test.ts` | 1 | provider selection |
| `aiCandidateSelection.test.ts` | 5 | 7, 8, 9, 10, 11, 12 |
| `aiPipeline.test.ts` | 9 | 18, 19, 20, 21, 22, 23, 24, 25, 26, 27 |
| `aiEvidenceNarrator.test.ts` | 5 | 15, 28, 29, 30 |
| `aiHealthScoreWiring.test.ts` | 3 | health-score boundary |

**Item 5 (missing model version) — not a directly-testable failure mode by design, not an oversight**: `modelVersion` is a required, non-optional field on the `AiProvider` interface itself (TypeScript) and `NOT NULL` at the database level — there is no code path where it could be "missing" without a compile error or a DB constraint violation, so no test simulates an impossible state. **Item 6 (unknown canonical ID)** is likewise structural: candidates are only ever sourced from `normalized_reviews` itself via `findCandidateReviews`, and `review_sentiment.canonical_review_id` has a real `FOREIGN KEY` constraint to `normalized_reviews` — proven indirectly (a normal run against real candidates never violates it) rather than by forcing an artificial FK violation, which would test Postgres's own FK enforcement, not this project's code.

---

## Coverage

```
Statements   : 79.25%
Branches     : 78.71%
Functions    : 90.09%
Lines        : 79.25%
```
`modules/ai/` (excluding providers): **95.56% statements**. `anthropicProvider.ts`: **0%** — honest, not padded; no test exercises it, exactly as flagged throughout. `mockAiProvider.ts`: 72.72% (the `narrate()` path's edge cases are covered via the dedicated narrator tests, not this file's own suite — acceptable, not a gap requiring more tests for their own sake).

---

## Performance

**MEASURED, all at real 100K-row local scale (mock provider):**

| Operation | Result |
|---|---|
| Dry-run (49,984 candidates) | 326ms–624ms, 0 AI calls, 0 writes |
| Real batch: 20 reviews (first smoke test) | 399ms |
| Real batch: 5,000 reviews, batch-size 100 | 16.54s (≈302 reviews/sec) |
| Candidate-selection query, 100-row page, before index fix | 49.66ms, 10,611 buffers (measured via `EXPLAIN ANALYZE`) |
| Candidate-selection query, after adding `idx_normalized_reviews_platform_canonical_id` (migration 011) | 29.29ms, 5,304 buffers |

**Honest caveat, stated plainly**: the ≈302 reviews/sec figure measures the mock provider's in-process function call plus the real DB write/validation path — it does **not** include real AI network latency. A real Anthropic call would very likely dominate total throughput (typically 1+ second per call), meaning **real-provider throughput is PROJECTED to be dramatically lower than this number, not measured** — this session had no key to measure it with, and I'm not implying otherwise.

**A real, measured gap was found and fixed, not hidden**: the candidate-selection query's keyset pagination (`WHERE platform=X ORDER BY canonical_review_id`) had no supporting index, forcing a full primary-key index scan with platform-filtering afterward. Added `idx_normalized_reviews_platform_canonical_id` (migration 011) — buffer reads roughly halved (10,611→5,304). Not a complete fix (the LEFT JOIN to `review_sentiment` for staleness-checking still has inherent cost — `Rows Removed by Filter: 5,020` in the plan), reported as a partial, real improvement, not oversold as fully solved.

---

## Known limitations

- Real Anthropic provider execution is entirely untested — code-complete, zero local or automated validation, by necessity (no key available).
- Real-provider throughput/cost is unmeasured — only the mock-provider processing overhead was measured.
- The narrator's evidence-citation validation stops fabricated *review IDs*; it cannot verify that the model's prose doesn't paraphrase a number incorrectly (e.g., misstating "42%" as "45%" in free text) — the structural guardrail is ID validation, not full semantic fact-checking of generated prose. Flagging this as a real, inherent limitation of the design, not solved by this phase.
- `computeComplaintScore`'s specific formula (average theme mentions per negative review, capped) is a Phase 4 placeholder alongside `trendToScore`/`ratingToScore` — same "hypothesis, not business-approved" caveat.
- The candidate-selection query's remaining LEFT JOIN cost (post-index) wasn't further optimized — acceptable at 100K/29ms, worth re-measuring at real production scale before assuming it's still fine.

## Future AI integration boundary

Unchanged in spirit from Phase 3, now populated: `review_sentiment`/`review_theme` hold real (mock-generated) data proving the schema/pipeline work end-to-end; the only missing piece for real classification is a provider swap (`AI_PROVIDER=anthropic` + a real key) — no code changes required, by design of the provider abstraction.

## GO/NO-GO

**GO** for continued local development with the mock provider — the full pipeline (candidate selection, staleness, batch processing, retry, idempotency, dry-run, evidence-validated narration, health-score wiring) is proven correct at both unit/integration and real 100K-row scale, with one real performance gap found and fixed along the way.

**NOT YET VALIDATED** for real Anthropic usage — that requires a decision (provide a key) and a fresh, explicit validation pass before any real spend, exactly as Step 10's cost-control design intends.

---

## Confirmations

```
PRODUCTION DATABASE ACCESSED: NO
PRODUCTION TABLES MODIFIED:   NONE
PRODUCTION TABLES CREATED:    NONE
PRODUCTION DATA MODIFIED:     NONE
DataWarehouse.flipkart_reviews / myntra_reviews: READ ONLY throughout — only ever read via the existing, unmodified Track A/B pipeline. No Phase 4 code touches these tables directly.
ANTHROPIC_API_KEY: not present anywhere in this environment; never committed; AnthropicProvider throws immediately if constructed without one.
```

**Stopping here. Not starting backend API, React frontend, dashboard UI, production integration, or production AI processing — waiting for your explicit approval.**
