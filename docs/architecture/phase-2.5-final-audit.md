# Product Review Intelligence Platform — Final Architecture Audit

**Phase 2.5 · Final Architecture Audit · Not for Implementation**

A section-by-section pass through all 26 parts of the Phase 2 architecture, re-verified against source code again this session — with two genuinely new findings this pass didn't surface before, on top of everything carried forward from the prior critical review.

- Audited: 2026-08-11
- Production DB: not modified
- No tables created
- Extends: [Phase 2.5 critical review](phase-2.5-critical-review.md) (does not replace it)

---

## Table of Contents

1. [Verdict](#verdict)
2. [Part 1 — All 26 Sections Reviewed](#part-1--all-26-sections-reviewed)
3. [Part 2 — Source Structure Re-Verification](#part-2--source-structure-re-verification)
4. [Part 3 — Production Database Safety](#part-3--production-database-safety)
5. [Part 4 — Identity / Duplicates](#part-4--identity--duplicates)
6. [Part 5 — Date Strategy](#part-5--date-strategy)
7. [Part 6 — Ingestion Correctness](#part-6--ingestion-correctness--is-it-production-safe)
8. [Part 7 — Data Model, Table by Table](#part-7--data-model-table-by-table)
9. [Part 8 — 1M → 50M Scale](#part-8--1m--50m-scale)
10. [Part 9 — Latest-30-Days Optimization](#part-9--latest-30-days-optimization--the-safest-efficient-design)
11. [Part 10 — Health Score](#part-10--health-score--the-volume-unfairness-question-answered-directly)
12. [Part 11 — Sample Size Thresholds](#part-11--sample-size-thresholds)
13. [Part 12 — Themes / Problems](#part-12--themes--problems--production-ready)
14. [Part 13 — AI](#part-13--ai--the-core-rule-and-its-remaining-failure-modes)
15. [Part 14 — Marketplace Comparison](#part-14--marketplace-comparison)
16. [Part 15 — API](#part-15--api--can-every-endpoint-scale)
17. [Part 16 — Backend Architecture](#part-16--backend-architecture)
18. [Part 17 — Frontend](#part-17--frontend--does-the-dashboard-answer-the-eight-questions)
19. [Part 18 — Security](#part-18--security--minimum-role-model-for-the-two-write-apis)
20. [Part 19 — Observability](#part-19--observability--whats-missing-for-production-support)
21. [Part 20 — Testing](#part-20--testing--the-complete-missing-test-list)
22. [Part 21 — Contradiction Detection](#part-21--contradiction-detection)
23. [Part 22 — Decisions Q1–Q14](#part-22--decisions-q1q14)
24. [Part 23 — Final Architecture Verdict](#part-23--final-architecture-verdict)
25. [Part 24 — Final Implementation Gate](#part-24--final-implementation-gate)

---

## Verdict

### READY AFTER REQUIRED CHANGES

Not READY, not NOT READY — a specific, scoped punch list stands between this architecture and Phase 1 implementation. Nothing found across two full review passes requires a redesign. Every issue below is a scoped fix or a decision only the user can make. Two items are genuinely blocking: the missing index on production `updatedAt` (needs explicit approval — it's a production DDL change), and the ambiguous AI-confidence field (needs a one-sentence definition before Phase 4, no approval needed, just a decision).

Two new findings this pass, both confirmed directly from source, neither present in the prior Phase 2.5 review:

1. Flipkart's `review_id` hash includes a computed absolute date that can itself shift by a day (or occasionally a month) between two crawls of the *same* physical review near a relative-date rounding boundary — meaning identity instability can run in the opposite direction from what was previously flagged: not just two different reviews colliding into one ID, but potentially one review producing two different IDs over time (Part 4).
2. Flipkart's `brand_name` is *not* frozen at first crawl the way Myntra's is — it's in both the product table's and the review table's own `updateOnDuplicate` list, confirmed directly in `ProductListRepository.js:59` and `ReviewRepository.js:62` — meaning a review's brand attribution can be silently overwritten on every re-crawl, on the Flipkart side specifically (Part 2, Phase 2 §7).

---

## Part 1 — All 26 Sections Reviewed

### Section 01 — Architecture Decision Summary — `APPROVED`
**Findings:** The six anchor decisions hold up under two full review passes. "Every AI claim is a resolved citation" is only fully true once §13's confidence-field ambiguity is resolved.
**Required changes:** None structural — depends on §13's fix landing.

### Section 02 — Data Architecture — `APPROVED`
**Findings:** Three-zone flow is correct and now doubly confirmed against source — the read-only zone genuinely never gets written to by anything in either crawler (`sync({alter:false})` verified directly this session, both repos).
**Required changes:** Cosmetic only — the flow diagram should show `ingestion_watermarks`/`rejects`/`anomalies` as a bookkeeping side-channel for completeness.

### Section 03 — Unified Review Model — `CHANGE REQUIRED`
**Findings:** Solid overall. Missing `source_row_id`, `ingested_at`, `mapper_version` (carried from Phase 2.5). Hash-algorithm rationale needs correcting — see Part 4.
**Required changes:** Add the three fields; correct the SHA-256 justification in the doc text.

### Section 04 — Identity Strategy — `CHANGE REQUIRED`
**Findings:** Composite key is correct. **NEW** — Flipkart's hash input includes a computed absolute date that can shift between crawls of the same review near a rounding boundary — an inverse identity-instability mode not previously documented (full detail in Part 4).
**Required changes:** Document this as a known limitation; extend `identity_anomalies`' intent to note it can't directly catch this mode (it manifests as an apparent new row, not a changed one).

### Section 05 — Date/Time Strategy — `CHANGE REQUIRED`
**Findings:** Core design confirmed sound against source. Missing a way to actually expose the day/month confidence mix per window (carried).
**Required changes:** Add `day_confidence_review_count`/`month_confidence_review_count` to `product_metrics_daily`.

### Section 06 — Data Quality Strategy — `APPROVED`
**Findings:** Quarantine-never-delete rule is sound and matches every check needed. Short/near-empty review text isn't explicitly gated before classification (cross-referenced in §12).
**Required changes:** None here — the gate belongs in the classification step, not ingestion validation.

### Section 07 — Intelligence Data Model — `CHANGE REQUIRED`
**Findings:** `theme_metrics_daily` dense-cross-product growth trap (critical, carried). `ai_insights.confidence` ambiguity (critical, carried). Missing fields from §3.
**Required changes:** Make sparsity explicit; define `confidence` precisely; add the three missing fields.

### Section 08 — Processing Pipeline — `CHANGE REQUIRED`
**Findings:** Backfill via `id` keyset pagination is sound — `id` is the PK, indexed on both tables, verified. Incremental cursor depends on the unindexed `updatedAt` problem (critical, carried).
**Required changes:** Resolve the index question (Part 6); this stage cannot be called production-safe until it is.

### Section 09 — Incremental Processing — `CHANGE REQUIRED`
**Findings:** Same index dependency. No job-locking mechanism specified (carried). Watermark-advance atomicity not specified (carried, low severity — idempotency absorbs it).
**Required changes:** Add advisory lock / running-idle status; make watermark-advance and batch-upsert one transaction.

### Section 10 — Product Health Score — `CHANGE REQUIRED`
**Findings:** Confirmed: as specified, a 5-review product *can* outrank a 500-review product on a lucky streak (Part 10 walks through why). Display-only confidence flag doesn't fix this (high, carried). Rating/sentiment correlation risk, severity-averaging concern (medium, carried).
**Required changes:** Add sample-size shrinkage to the formula itself before Phase 3 sign-off.

### Section 11 — Problem Detection — `CHANGE REQUIRED`
**Findings:** Hybrid deterministic+AI approach is sound in shape. Hinglish/short-text/taxonomy-versioning gaps unaddressed (carried).
**Required changes:** Evaluate classification against Hinglish samples; add a minimum-text-length gate; define a taxonomy-edit migration path.

### Section 12 — Root Cause Architecture — `APPROVED`
**Findings:** Deterministic certainty-gating design is genuinely sound — the model can't unilaterally escalate hypothesis language. No changes found on a second pass.
**Required changes:** None.

### Section 13 — AI Architecture — `CHANGE REQUIRED — CRITICAL`
**Findings:** `ai_insights.confidence` ambiguity is the single most important AI-safety gap in the whole document (carried, critical). **NEW** — model/prompt version drift: a hosted model behind a stable ID can change behavior silently; Phase 2 doesn't separate model-version from prompt-version as two distinct axes.
**Required changes:** Define `confidence` as platform-computed only, never model-originated. Pin to dated model snapshots where the provider allows it; track `model_version` and `prompt_version` independently.

### Section 14 — Evidence Architecture — `APPROVED`
**Findings:** Resolved-at-read-time citation design is sound, confirmed again this pass. No changes.
**Required changes:** None.

### Section 15 — Marketplace Comparison — `CHANGE REQUIRED`
**Findings:** Deferring to brand-level given the missing product join key is the right call, confirmed again (Part 14). Product-mix confound isn't written into the spec as a UI requirement (high, carried).
**Required changes:** Make the volume-display + disclosure requirement an explicit part of §15's design, not just a review note.

### Section 16 — Early Warning System — `NOT VERIFIED`
**Findings:** Rule shapes are sound and deterministic, consistent with the AI-not-source-of-truth principle. Exact thresholds are unvalidated starting points (already flagged as such in Phase 2 itself).
**Required changes:** None to the design; thresholds need real historical data before Phase 5 tuning (Q11).

### Section 17 — Backend Architecture — `CHANGE REQUIRED`
**Findings:** No circular dependencies found in the module graph as specified (`insights → rootCause → {metrics, reviews}`; `ai` only ever called into, never calling back up) — a genuinely clean result. Read-only defense-in-depth not specified (carried). **NEW** — recommend the ingestion module define its own thin read-query layer rather than importing the crawler repos' Sequelize models directly, even for reading — keeps the two codebases fully decoupled so a crawler-side change can't propagate a write-capable model into this platform by accident.
**Required changes:** No write-capable ORM surface in `prodReadOnly`; don't reuse crawler model definitions.

### Section 18 — API Architecture — `CHANGE REQUIRED`
**Findings:** Missing rankings-sort index on `product_health_scores` (carried). Product Detail N+1 risk on evidence resolution (carried). No regeneration-status polling contract (carried, minor).
**Required changes:** Add the index; require batched evidence resolution as an implementation constraint; document the polling contract.

### Section 19 — Frontend Architecture — `CHANGE REQUIRED`
**Findings:** A product's own detail page has no path to "is this marketplace-specific?" — the platform's own headline question (carried, medium).
**Required changes:** Add a cross-link from Product Detail to the same brand's Marketplace Comparison view.

### Section 20 — Scalability — `CHANGE REQUIRED`
**Findings:** "Never a full-table aggregate" claim doesn't hold for the AI Analyst as currently unscoped (carried, high). `theme_metrics_daily` sparsity must be explicit or the claim breaks there too (carried).
**Required changes:** Explicitly scope the Analyst to precomputed-intelligence retrieval for v1; state the sparsity constraint.

### Section 21 — Security — `CHANGE REQUIRED`
**Findings:** DB-role plan is correct but is the only layer specified (carried). **NEW** — no startup check that `prodReadOnly` and `appStore` connection configs are actually different (a copy-paste config mistake would run silently). **NEW** — no ongoing canary-write monitoring in production, only a one-time Phase 0 check.
**Required changes:** Add the startup config-divergence assertion; add a scheduled canary-write test that alerts if a write ever unexpectedly succeeds through the read-only credentials.

### Section 22 — Observability — `CHANGE REQUIRED`
**Findings:** Comprehensive otherwise. No stated rule on raw review text appearing in structured logs (carried, low).
**Required changes:** Logs reference `canonical_review_id` only, never raw review text.

### Section 23 — Testing — `CHANGE REQUIRED`
**Findings:** Solid baseline plan. Missing the tests enumerated in Part 20, including **NEW** a specific test for the date-boundary identity-instability scenario found in Part 4.
**Required changes:** Add the full list in Part 20.

### Section 24 — Implementation Roadmap — `CHANGE REQUIRED`
**Findings:** Phase sequencing is sound. Phase 0's completion criteria don't yet include the index-approval decision or ongoing canary-write monitoring as gate items.
**Required changes:** Add both to Phase 0's explicit completion criteria.

### Section 25 — Risks — `CHANGE REQUIRED`
**Findings:** Accurate as far as it goes. Missing the two new risks from this pass: date-boundary identity instability (Part 4), and Flipkart's per-review `brand_name` being overwritable on every re-crawl (Phase 2 §7, verified this session).
**Required changes:** Add both to the risk register.

### Section 26 — Decisions Required From You — `CHANGE REQUIRED`
**Findings:** Fourteen decisions listed; two more surfaced since (index approval, AI-confidence definition) aren't in the list yet.
**Required changes:** Add both as explicit items — see Part 22 for the full, current list.

---

## Part 2 — Source Structure Re-Verification

Everything from the prior critical review still holds and was not re-litigated. Two items newly resolved this session, both directly from source, neither guessed:

| Claim | Status | Detail |
|---|---|---|
| `sync({ alter: false })` — no schema-altering calls anywhere in either crawler | **VERIFIED FROM CODE** | `flipkart-product-crawler/src/database/sync.js` and `myntra-product-crawler/src/database/sync.js`, read directly this session — both contain the identical comment: "Existing tables and unrelated tables in the schema are never dropped... Schema changes must be applied manually at the DB level." |
| Flipkart `brand_name` is **not** frozen at first crawl (unlike Myntra) | **VERIFIED FROM CODE** | `ProductListRepository.js:59` — `updateOnDuplicate: ['brandName', 'sku', 'active', 'updatedAt']` at the product-list level, *and* `ReviewRepository.js:62` — `brandName` is also in the review-level `updateOnDuplicate` list. Every re-crawl can overwrite both the product's and the review's stored brand. This directly contradicts the assumption made in the Phase 2.5 review that `normalized_reviews.brand` preserves "what was actually scraped at the time" for Flipkart — it doesn't; it reflects whichever crawl most recently touched that row. |

All other Part 1/2 items (PKs, indexes, review-ID generation, no delete logic, TZ settings, no FK associations) are unchanged from the prior review and remain **VERIFIED FROM CODE**.

---

## Part 3 — Production Database Safety

Every place an accidental write could theoretically originate, and the structural fix for each:

| Risk | Structural fix |
|---|---|
| A developer imports a write-capable Sequelize model into the `prodReadOnly` connection module | That module exposes only raw parameterized `SELECT` — no ORM model classes with `create`/`update`/`destroy`/`sync` are ever imported into it. |
| A developer reuses the crawler repos' own Sequelize model definitions (which do carry `sync()` capability) for reading, out of convenience | This platform defines its own thin, read-only query layer against the verified schema (Part 2) — never imports the crawler repos' model files at all, even to read. |
| The production DB role is ever mis-provisioned with more than SELECT (an ops mistake, outside this codebase) | A scheduled canary job periodically attempts a harmless write through the read-only credentials and **alerts if it ever succeeds** — turns the one-time Phase 0 permission test into an ongoing production safeguard, not a point-in-time check. |
| A config file accidentally points `appStore`'s write-capable connection at the same host/database as `prodReadOnly` (copy-paste mistake) | A startup assertion compares the two connection configs' host/database/user and refuses to boot if they're identical. |

---

## Part 4 — Identity / Duplicates

Walking through exactly what happens in each named scenario — no assumption that "no duplicates observed" means safe:

| Scenario | What actually happens |
|---|---|
| **A.** Same review ingested twice | Safe. `canonical_review_id` is deterministic from `(platform, source_product_id, source_review_id)`; the second ingestion is a no-op `ON CONFLICT DO UPDATE` against the same row. |
| **B.** Same source row changes (rating/text edited) | Safe, by design. `updatedAt` bumps (verified in both `updateOnDuplicate` lists), the watermark eventually re-reads it (subject to the index/safety-lag fixes in Part 6), `canonical_review_id` is unchanged since it doesn't depend on content, `content_hash` changes and triggers reprocessing. |
| **C.** Source review ID changes | Cannot happen for Myntra — the native API ID is permanent. For Flipkart, the ID is *recomputed* every crawl from `pid\|author\|absoluteDate\|rating\|title`. **NEW, this pass** — the `absoluteDate` component is itself computed fresh from "now minus relative offset" on every crawl. Near a day-boundary (a review crawled once just before local midnight, again just after) or a month-boundary (relative text crosses from "N days ago" into "1 month ago" between two crawls, which anchors to the 1st of a different month), the *same physical review* can resolve to two different absolute dates across two crawls — and therefore two different `review_id` hashes. The platform would see this as an apparently new row, not an update, and would carry both under separate `canonical_review_id`s indefinitely. This is genuinely plausible given the parser logic read this session; whether it happens in practice at meaningful frequency is **NOT VERIFIED** without live data. |
| **D.** Two reviews share the same synthetic Flipkart ID (a true collision — different reviews, same author/day/rating/title) | The second write silently overwrites the first *in the source table itself* — this platform can only detect the symptom (a content-hash mismatch under the same `canonical_review_id` across two ingestion runs), log it to `identity_anomalies`, and cannot recover the lost review; it was already gone upstream. |
| **E.** A review "moves" to a different product (e.g. a listing consolidation changes `pid`) | Since `canonical_review_id` includes `source_product_id`, a `pid` change produces a brand-new canonical ID; the old row is simply orphaned under the old key, not updated. No evidence either crawler does this today (no delete/merge logic found), so this is a theoretical case, not an observed one. |
| **F.** Source crawler overwrites a review (a legitimate re-scrape catching an edit) | Same mechanics as B — handled correctly. |

> **Clarifying distinction:** Scenario C (identity instability from date-hash drift) and the confirmed brand-overwrite finding (Part 2) are *different* problems. `canonical_review_id` doesn't include `brand`, so a brand-value change never creates a duplicate row — it just silently changes an attribute on the existing row. Don't conflate the two when triaging.

---

## Part 5 — Date Strategy

Re-confirmed sound in design, unchanged from the prior review: no fabricated timestamps, IST-anchored boundaries, `date_confidence` correctly modeled as permanent-once-set. The one required change is still open: without a per-window day/month confidence breakdown stored in `product_metrics_daily` (Phase 2.5 review §3, this document's §05), the 30-day figure's actual precision is invisible to the API and the frontend — a real, checkable way this *could* mislead if left unaddressed, not a hypothetical one.

---

## Part 6 — Ingestion Correctness — is it production-safe?

**As currently specified: no.** Three fixes make it yes, none requiring a redesign:

1. **Index dependency (critical).** Neither table indexes `updatedAt` — the incremental query is a full scan today. Needs explicit decision (Part 22, and the original blocking item from the prior review).
2. **Watermark safety-lag (high).** A bare `>` cursor can miss late-committing rows. Fix: never advance past `now() − safety_lag`, always re-scan the trailing buffer.
3. **Job locking (medium).** No mutual-exclusion mechanism specified between backfill and incremental runs, or between overlapping incremental runs. Fix: advisory lock or explicit running/idle status.

Everything else audited here checks out: crash recovery and partial-batch failure are absorbed by idempotent upserts (verified consistent with how both crawlers already write); retry follows the same `p-retry` exponential-backoff pattern already used upstream; clock/timezone handling is consistent (`TZ=Asia/Kolkata` verified in both packages' npm scripts); watermark-advance atomicity is a performance nicety, not a correctness requirement, given idempotency.

---

## Part 7 — Data Model, Table by Table

| Table | Verdict | Note |
|---|---|---|
| `normalized_reviews` | CHANGE | Add `source_row_id`, `ingested_at`, `mapper_version` (§3). |
| `products` | CHANGE | "Most-recently-seen" brand semantics need re-examining given the Flipkart overwrite finding (Part 2) — this table's refresh behavior should probably not blindly trust the latest crawl's brand value without at least logging when it changes. |
| `review_intelligence` | APPROVED | Sound as specified. |
| `themes` / `review_themes` | CHANGE | Needs an explicit taxonomy-edit migration path (§11). |
| `product_metrics_daily` | CHANGE | Add day/month confidence-count fields (Part 5). |
| `theme_metrics_daily` | **CHANGE — CRITICAL** | Must be sparse (mention_count > 0 only), or this table alone could exceed `normalized_reviews` in row count within a year. |
| `marketplace_metrics_daily` | APPROVED | Sound given brand-level-only scope for now. |
| `product_health_scores` | CHANGE | Formula needs shrinkage before this table's numbers are trustworthy at low sample sizes (Part 10). |
| `trend_snapshots` | APPROVED | Sound, including the planned daily→weekly downsampling past 90 days. |
| `early_warning_signals` | NOT VERIFIED | Design sound; thresholds unvalidated pending real data. |
| `ai_insights` | **CHANGE — CRITICAL** | `confidence` field needs an explicit, unambiguous definition before this table is populated. |
| `ingestion_watermarks` | CHANGE | Needs a running/idle status column to support job locking (Part 6). |
| `ingestion_rejects` | APPROVED | Sound; a supporting index on `(platform, first_seen_at)` would help the 90-day retention sweep but isn't blocking. |
| `identity_anomalies` | CHANGE | Its intent should explicitly note it catches content-drift-under-same-ID but not the inverse (same-review-different-ID) failure mode from §4C. |

No missing tables identified — the fifteen proposed cover every stage of the pipeline with no gap requiring a sixteenth entity.

---

## Part 8 — 1M → 50M Scale

Unchanged from the prior review's conclusions, reconfirmed: Postgres remains the right choice through 50M+ rows for this workload shape; `normalized_reviews`/`review_intelligence` need month-partitioning starting around 50M for maintenance (not query-speed) reasons; nightly aggregation must mean "recompute what changed," not "recompute everything," once truly large; AI cost stays flat relative to corpus size only if content-hash caching works correctly (a Phase 4 gate, not an assumption).

**Ingestion throughput specifically:** since backfill reads directly from Postgres (not re-scraping), 1M rows via indexed `id`-keyset pagination is a matter of minutes, not hours — this stage was never the bottleneck. The bottleneck is entirely the unindexed incremental scan (Part 6), which is a recurring cost, not a one-time backfill cost.

**Does "dashboard queries mostly hit product × day aggregates" hold for every endpoint?** For all precomputed-table-backed endpoints, yes — confirmed by re-walking the full endpoint list in Phase 2 §18. The one endpoint where it does *not* hold as specified is the AI Product Analyst, whose retrieval mechanism for arbitrary questions was never actually defined (Phase 2.5 review §20) — this is the one place the scalability claim needs the explicit v1 scoping fix already recommended.

---

## Part 9 — Latest-30-Days Optimization — the safest efficient design

| Window | Strategy |
|---|---|
| Latest 30 days | **Precomputed** in `product_metrics_daily`; **incrementally updated** intraday for today's row; **nightly recomputed** for the full trailing 30-day window specifically (not all history) as a correctness pass, since late-arriving/edited reviews (Part 6) can still land inside an already-closed day. |
| Previous 30 days (comparison period) | **Precomputed**, same table. Mostly static once the window closes, but still needs periodic (not nightly-urgent) re-validation against late edits to older reviews — a weekly sweep is enough. |
| 90 days / 6 months | **Precomputed** via the same daily table, summed at query time or via precomputed weekly rollups in `trend_snapshots` (as Phase 2 already specifies past 90 days). |
| 1 year+ | **Precomputed**, full daily granularity retained in `product_metrics_daily` (cheap — products × days, not products × reviews); `trend_snapshots` downsamples to weekly beyond 90 days. |
| Evidence / arbitrary lookups | **Queried live** — but only ever as point lookups by `canonical_review_id`, never a scan. |
| Cross-product aggregation endpoints (Executive Dashboard, Rankings, Problems) | **Cached**, short TTL, in front of otherwise-cheap precomputed reads — the caching layer exists to protect against many simultaneous requests, not because any individual query is slow. |

---

## Part 10 — Health Score — the volume-unfairness question, answered directly

> **Direct answer: Yes, confirmed.** Under the formula exactly as specified in Phase 2, a product with 5 reviews, all 5-star, zero complaints scores a perfect or near-perfect result across every component — rating, sentiment, complaint frequency, complaint severity — and can straightforwardly outrank a genuinely excellent 500-review product that has the ordinary small amount of noise real products accumulate at volume. The confidence tag correctly flags this as low-confidence, but the score itself, which is what drives the Rankings sort, is unaffected by that tag.

**Statistically defensible fix** (concrete, not hand-wavy): apply Bayesian/Wilson-style shrinkage to each rate-based component before combining them —

```
shrunk_rate = (n / (n + k)) * observed_rate + (k / (n + k)) * baseline_rate
```

where `n` is the review count in the window, `k` is a tunable prior strength (e.g. `k=20`, meaning "trust the observed rate as much as the baseline once you have ~20 reviews"), and `baseline_rate` is the platform- or category-wide average. This pulls low-`n` products toward the average in proportion to how little evidence exists, and converges to the raw observed rate as `n` grows — exactly the property the current display-only flag doesn't provide. Score stays fully deterministic; nothing here involves AI.

---

## Part 11 — Sample Size Thresholds

The 10/30 boundaries should not be accepted as-is. **Evidence needed before finalizing:** the actual distribution of reviews-per-product across the real corpus (median, p10, p90) — round numbers picked before seeing that distribution are guesses, not thresholds. Recommend a one-time analysis pass immediately after Phase 1 backfill, before Phase 3 sign-off, to calibrate against reality.

**More robust alternative:** the shrinkage weight from Part 10, `n/(n+k)`, is itself a continuous confidence measure and is strictly better than three discrete buckets — a product with 9 reviews and one with 10 shouldn't fall on opposite sides of a hard cliff. Recommend using the continuous weight as the actual confidence signal, with discrete labels (low/medium/high) derived from it only for display purposes, not as the underlying computation.

---

## Part 12 — Themes / Problems — production-ready?

**Not yet, as specified.** The hybrid architecture is sound in shape (data-driven taxonomy, deterministic rules + AI for nuance, many-to-many junction already supports multi-complaint reviews). What's missing before it's production-ready: evaluation against Hinglish/mixed-script text specifically (not just English), an explicit minimum-text-length gate before classification is even attempted (distinct from just tagging low-confidence after), and a defined migration path for taxonomy edits (rename/split/merge) that existing tagged rows would otherwise be orphaned against. None of these require a design change — they're implementation-readiness gaps, not architecture flaws.

---

## Part 13 — AI — the core rule and its remaining failure modes

**Rule verified intact across every other AI touchpoint:** counts, percentages, ratings, scores, and trends are computed exclusively by the deterministic layer everywhere except the one gap below — evidence selection, citation validation, structured output, and certainty-language gating are all genuinely sound on a second pass.

> **The one remaining violation risk:** `ai_insights.confidence`, as specified, could be implemented as the model self-reporting a number — which *would* violate the rule, since LLM self-rated confidence is a well-documented unreliable, uncalibrated behavior, i.e. the model inventing a number. This must be fixed before Phase 4, not discovered during it.

**New failure mode this pass:** model/prompt version drift. A hosted model referenced by a stable ID can change behavior without notice; Phase 2 tracks only `model_version`, conflating "which model" with "which prompt template" into one axis. Recommend tracking both independently, and pinning to dated model snapshots wherever the provider supports it, so a silent provider-side model update doesn't retroactively make historical `ai_insights` rows misleading about what actually produced them.

---

## Part 14 — Marketplace Comparison

Brand-level-first, no guessed product mapping — confirmed correct again on this pass, for the same reason as before: no shared join key exists, and fabricating one (fuzzy matching) would trade a known gap for an unknown, unquantifiable error rate. Product-mix confound (different products sold under one brand per platform) remains real and uncorrectable with current data (no category field on either source table). The UI must show review-count-per-platform alongside every brand comparison and disclose the product-mix caveat directly — this needs to move from "review recommendation" to "written requirement" in the spec.

---

## Part 15 — API — can every endpoint scale?

Yes, for the majority — every endpoint backed by a precomputed daily/aggregate table is inherently cheap regardless of raw review volume, confirmed by re-walking the full endpoint table in Phase 2 §18 against the scale findings in Part 8. Two gaps prevent a clean yes across the board: the missing rankings-sort index (§18) and the unscoped Analyst retrieval mechanism (Part 8, Part 20). Pagination, filtering, and sorting on all list endpoints are correctly specified as server-driven throughout — no client-side full-dataset sorting anywhere in the design.

---

## Part 16 — Backend Architecture

Traced the module dependency graph explicitly this pass: `insights` depends on `rootCause`, `ai`, and evidence resolution via `reviews`; `rootCause` depends on `metrics` and `reviews`; `ai` is called into by both but never calls back up into either; `dashboard` composes everything read-only. **No circular dependencies found** — a clean result worth stating positively, not just auditing for problems. Responsibility boundaries (repository/service/domain/controller, deliberately absent where inappropriate) remain sound from the first read.

Two additions: no runtime guarantee yet that the `prodReadOnly` module can't expose a write surface (Part 3); and this platform's ingestion module should define its own read-query layer rather than importing the crawler repos' Sequelize models even for reading, to keep the two codebases fully decoupled (Part 3, §17).

---

## Part 17 — Frontend — does the dashboard answer the eight questions?

Seven of eight are directly answerable as designed: unhealthy products (Rankings), why (theme breakdown + root cause on Product Detail), what changed (Trends), which problem is increasing (Problems page + trend deltas), what evidence proves it (EvidenceDrawer, universally applied), what action to take (AI Insights/Recommendations), how confident to be (ConfidenceBadge, contingent on Part 5's confidence fields actually landing in the data model). **"Which marketplace" is the one gap** — a single product's own page structurally can't answer this since it only ever shows one platform's data (§19); needs the cross-link fix.

---

## Part 18 — Security — minimum role model for the two write APIs

`POST /insights/regenerate` and `PATCH /early-warnings/:id` are the only two write-capable endpoints in the entire API surface, and both write only to this platform's own store, never production. Minimum viable role model: **`viewer`** (read-only dashboard access — every `GET` endpoint) and **`analyst`** (everything `viewer` has, plus both write endpoints). No finer granularity is justified by the two-endpoint surface as currently scoped; a role split finer than this would be speculative complexity. Who at the organization holds `analyst` is Q13 (Part 22) — an org decision, not an architectural one.

Carried from Part 3: DB-role plan is correct but needs code-level defense-in-depth (no write-capable ORM surface in the read path), a startup config-divergence assertion, and ongoing canary-write monitoring, not just a one-time Phase 0 check.

---

## Part 19 — Observability — what's missing for production support

The design already covers structured logs with correlation IDs, per-run processing metrics, job status, rejection/anomaly surfacing, data freshness, AI cost/usage, API latency, and a composite pipeline-health view — genuinely comprehensive. The one gap: no explicit rule that raw review text must never appear in logs (only `canonical_review_id` references) — customer-authored text can incidentally carry names or contact details pasted by reviewers.

---

## Part 20 — Testing — the complete missing-test list

- Idempotency: run ingestion twice over the same window, assert identical resulting state.
- Crash recovery: kill the ingestion process mid-batch, assert restart reprocesses safely with no duplication.
- Watermark correctness under safety-lag: simulate a row committing with an `updatedAt` earlier than an already-processed watermark, assert it's still picked up.
- Duplicate data: same source row submitted twice in one batch (already handled by in-batch dedup per the crawler's own pattern — verify this platform's ingestion does the same).
- **NEW** Identity instability: simulate the same physical Flipkart review crawled twice near a relative-date rounding boundary, confirm the resulting behavior (two rows under two canonical IDs) is at least non-catastrophic for downstream aggregates, even though it isn't perfectly deduplicated.
- Date boundary / timezone: reviews exactly at IST midnight, confirm correct day-bucketing.
- Aggregation correctness: known fixture → known expected `product_metrics_daily` values.
- Score correctness: known input → expected health score, across weight configs and the new shrinkage formula.
- AI citation validity: every cited `canonical_review_id` in generated output must exist, belong to the claimed product, and have been in the actual input bundle.
- AI self-confidence leak: assert the literal prompt content never asks the model to self-rate confidence.
- Prompt injection: review text containing injection attempts doesn't alter structured-output schema compliance.
- Authorization: `viewer` cannot reach either write endpoint; `analyst` can reach both.
- Rate limiting: Analyst endpoint specifically, under burst load.
- 1M / 10M performance: aggregation job timing and API p95 at synthetic scale.
- Full end-to-end: synthetic raw review → ingest → normalize → classify → aggregate → score → insight → API → verify the whole chain.

---

## Part 21 — Contradiction Detection

Re-checked against the current Phase 2 document — nothing has changed in it since the prior review, so all five contradictions found then are still present and still need the same fixes:

| Contradiction | Where |
|---|---|
| "AI never computes a number" vs. `ai_insights.confidence` as part of AI structured output | Phase 2 §1 vs. §13 — still the top-priority fix. |
| §5 promises visually distinguishable day/month-precision trend segments; no field exists to carry that distinction into an aggregate | Phase 2 §5 vs. §7 |
| "Never a full-table aggregate" (§20) vs. the AI Analyst's unspecified retrieval mechanism | Phase 2 §13/§18 vs. §20 |
| Three unrelated fields all named "confidence" with no unifying definition | Phase 2 §10, §12, §13 |
| Content-hash-triggered and version-triggered reprocessing aren't reconciled for overlapping rows | Phase 2 §9 vs. §7 |

No new contradictions found this pass beyond what was already logged — this pass's new findings (Part 2, Part 4C) are gaps/risks, not internal inconsistencies within the document itself.

---

## Part 22 — Decisions Q1–Q14

| # | Means | Recommendation | Why | Blocks implementation? |
|---|---|---|---|---|
| Q1 | How this platform gets DB access | Provision a new dedicated read-only role, don't reuse crawler credentials | Crawler role has write access; reusing it defeats defense-in-depth even for SELECT-only use | Yes — blocks Phase 0/1 entirely |
| Q2 | Where the platform's own writable data lives | A separate schema, same RDS instance, as the pragmatic default | No new infra to stand up; still fully isolated by role/schema boundary | Partially — blocks schema creation in Phase 2, not the ingestion read side |
| Q3 | AI provider and budget | Anthropic Claude, tiered by task (cheap model for classification, stronger for synthesis) | Matches the tooling already in use in this project's context; tiering is a direct cost control (Phase 2 §13) | Blocks Phase 4 only |
| Q4 | Caching infrastructure | Defer — start without Redis, add only once real traffic patterns justify it | Precomputed tables are already fast; premature caching infra is unjustified complexity | No |
| Q5 | Job scheduler mechanism | A queue with built-in locking (e.g. pg-boss) over bare cron | Directly solves the job-locking gap found in Part 6/§09 as a side effect | Blocks Phase 1's scheduled-job implementation specifically |
| Q6 | Dashboard access control | Session/token auth at minimum, two roles per §18 (`viewer`, `analyst`) | Internal business tool, not public; two-role model matches the two-endpoint write surface exactly | Blocks Phase 6 auth implementation, not earlier design |
| Q7 | Frontend framework | React + Vite, absent an established org convention | Matches the component-based design in Phase 2 §19; lightweight | Blocks Phase 7 only |
| Q8 | Hosting/deploy target | No strong recommendation without infra context | NOT VERIFIED — no docker/PM2/deploy config found in either sibling crawler repo to infer a convention from | Blocks Phase 8 planning, not earlier |
| Q9 | Future-marketplace scope | Keep the existing platform abstraction as-is; don't build further speculative generality | The enum + canonical-model pattern already generalizes cheaply; more investment now would be premature | No |
| Q10 | Health-score formula weights | Do not approve as-is — add shrinkage (Part 10) first, then validate weights against real product samples | The unshrunk formula demonstrably lets low-volume products outrank high-volume ones (Part 10) | Blocks Phase 3 sign-off |
| Q11 | Early-warning thresholds | Defer exact numbers to Phase 5, once real historical variance data exists | Can't tune noise thresholds without seeing real variance | Blocks Phase 5 final tuning only |
| Q12 | Cross-platform product mapping strategy | Stay at brand-level indefinitely unless the business specifically needs product-level and can supply a mapping | No join key exists; fuzzy-matching trades a known gap for an unquantifiable one (Part 14) | No — brand-level is already the day-one design |
| Q13 | Who holds the `analyst` role | An org decision — name specific people/teams | Only two write endpoints exist (Part 18); the technical role model is already minimal and settled | Blocks Phase 6 write-endpoint auth |
| Q14 | Minimum sample-size confidence thresholds | Defer exact numbers; use continuous shrinkage weight (Part 11) as the real signal, discrete labels only for display | Round numbers picked blind aren't defensible; the continuous measure is strictly better anyway | Blocks final Phase 3 tuning, not earlier design |

> **Two additional decisions, not originally numbered Q1–Q14:**
>
> **Index approval** (Part 6): approve a new read-supporting index on production `updatedAt`, or accept bounded full-scan cadence, or partial `id`-range mitigation. **Blocks Phase 1 implementation** — the single most load-bearing open item in this entire audit, and the only one requiring approval for a production DDL change specifically.
>
> **`ai_insights.confidence` definition** (Part 13): confirm it is platform-computed and merely echoed, never model-originated. No approval needed, just a decision — but blocks Phase 4 until settled in writing.

---

## Part 23 — Final Architecture Verdict

### READY AFTER REQUIRED CHANGES

Every blocker below is scoped and specific — none requires reconsidering the architecture's fundamental shape (three-zone storage, deterministic-metrics/AI-narrates boundary, composite identity, precomputed-aggregate dashboard reads all remain sound across two full review passes).

### Blockers

- **Index-approval decision** — the only item requiring explicit sign-off for a production change. Blocks Phase 1.
- **`ai_insights.confidence` definition** — blocks Phase 4, cheap to resolve now.
- **`theme_metrics_daily` sparsity** must be written into the spec as a hard constraint before Phase 2 (deterministic base) implementation.
- **Health-score shrinkage design** must be settled before Phase 3 sign-off — retrofitting it after real weights are chosen would mean re-doing that validation work.
- **Q1–Q3** (DB role, own-store location, AI provider) need answers before their respective phases can start, in roadmap order.

---

## Part 24 — Final Implementation Gate

| # | Gate | Status | Evidence | Required Action |
|---|---|---|---|---|
| 1 | Production DB read-only access | **USER APPROVAL REQUIRED** | Role design documented (Phase 2 §21), not yet provisioned | Approve provisioning (Q1) |
| 2 | Own writable DB | **USER APPROVAL REQUIRED** | Design sound; location undecided | Answer Q2 |
| 3 | No production writes (structural guarantee) | **FAIL** | DB-role plan sound but code-level defense-in-depth not yet designed into the module boundary | Add no-write-surface constraint to `prodReadOnly` module design (Part 3) |
| 4 | Source schema verification | **PASS** | PKs, indexes, upsert columns, hash generation, TZ settings all verified from code directly, twice | None |
| 5 | Identity strategy | **FAIL** | Sound core design; missing fields, hash-framing correction, and the new date-boundary instability mode undocumented | §03/§04 fixes |
| 6 | Date strategy | **FAIL** | Sound core design; missing confidence-count propagation fields | §05 fix |
| 7 | Ingestion strategy | **FAIL** | Depends directly on the index decision | Part 6 fixes |
| 8 | Watermark strategy | **FAIL** | No safety-lag, no job lock specified | Part 6 fixes |
| 9 | Idempotency | **PASS** | Deterministic canonical ID + upsert verified consistent with source upsert behavior | None |
| 10 | Data model | **FAIL** | Sparsity constraint and a few fields missing across several tables (Part 7) | Part 7 fixes |
| 11 | Indexes (platform-owned + production read-support) | **FAIL** | Rankings-sort index missing; production index needs approval | Add index; resolve index decision |
| 12 | Scalability | **FAIL** | Analyst retrieval scope unspecified undermines the stated claim for one endpoint | Scope the Analyst explicitly (Part 8/Part 20 of prior review) |
| 13 | Health score | **FAIL** | Confirmed volume-unfairness (Part 10); needs shrinkage | Add shrinkage formula |
| 14 | Confidence thresholds | **NOT VERIFIED** | No real data yet to calibrate against | Analyze real distribution post-backfill (Part 11) |
| 15 | Theme taxonomy | **FAIL** | Hinglish, short-text gating, versioning migration all open (Part 12) | Part 12 fixes |
| 16 | AI safety | **FAIL** | Confidence-field ambiguity is a real, not hypothetical, violation risk (Part 13) | Define `confidence` explicitly |
| 17 | Evidence validation | **PASS** | Sound on two review passes | None |
| 18 | API | **FAIL** | Missing index, N+1 requirement, regen-status gap (Part 15) | §18 fixes |
| 19 | Security | **FAIL** | Defense-in-depth, config-divergence check, canary monitoring, role model all need to be written in (Part 18) | Part 3/Part 18 fixes |
| 20 | Observability | **FAIL** | Comprehensive except the PII-in-logs rule (Part 19) | Add the rule |
| 21 | Testing | **FAIL** | Baseline solid; missing test list is long (Part 20) | Add tests in Part 20 |
| 22 | Deployment | **NOT VERIFIED** | Hosting (Q8) and scheduler (Q5) undecided | Answer Q5, Q8 |
| 23 | Documentation | **PASS** | Discovery, architecture, and two critical-review documents all published to `docs/architecture/` per the Phase 1 documentation plan | None — this document included |

---

*Audit only — no application code, database objects, or crawler code were created or modified. Everything marked FAIL is a scoped, specific fix, not a redesign; everything marked USER APPROVAL REQUIRED needs explicit confirmation before it moves, especially gate #1's production index question.*

*Source: [Final architecture audit artifact](https://claude.ai/code/artifact/102607d8-720c-4468-b0c6-5ff5bd046ffa)*
