# Product Review Intelligence Platform — Final Pre-Implementation Architecture

**Phase 2.9 · Final Pre-Implementation Architecture · Awaiting Approval**

Every remaining FAIL and NOT VERIFIED gate from Phase 2.8, resolved into an actual final design where design alone can resolve it — and honestly split apart where it can't. The Phase 2.8 ingestion design is unchanged and not revisited except where explicitly cross-referenced.

- 2026-08-11
- Production DB: not modified
- No tables created
- Builds on: Phase 2, 2.5, 2.6, 2.7, 2.8

---

## Verdict: Architecture Is Now Design-Complete

Every open item from the Phase 2.8 gate has been resolved one of three ways: finalized by design (no longer blocking), split into "design finalized, values need real data" where that's the honest state, or left as an explicit decision only the user can make. Nothing remaining requires further architectural work — what's left is approvals, decisions, and data that doesn't exist until Phase 1 runs. Full gate below.

---

## Part A — Gate Resolution Map

Every FAIL/NOT VERIFIED row from the Phase 2.8 gate, and where it's resolved below.

| Phase 2.8 gate # | What was missing | Resolvable by design? | Resolved in |
|---|---|---|---|
| 3 — No production writes | Structural guarantee not yet designed | Yes, fully | Part I — five-layer defense-in-depth |
| 5 — Identity strategy | Missing fields, hash framing, date-boundary instability undocumented | Yes, fully | Part B |
| 6 — Date strategy | Missing confidence-count propagation fields | Yes, fully | Part C |
| 10 — Data model | Sparsity constraints, missing fields across several tables | Yes, fully | Part D |
| 12 — Scalability | Analyst retrieval scope, sparsity constraint unwritten | Yes, fully | Part E |
| 13 — Health score | Formula unfair to low-volume products | Formula: yes. Exact weights: no | Part F — split |
| 14 — Confidence thresholds | Arbitrary row-count buckets | Mechanism: yes. Calibration constant: no | Part F — split |
| 15 — Theme taxonomy | Hinglish, short-text gate, versioning path | Design: yes. Accuracy validation: no | Part G — split |
| 16 — AI safety | `confidence` field ambiguity | Yes, fully | Part G |
| 18 — API | Missing index, N+1 risk, regen-status gap | Yes, fully | Part H |
| 19 — Security | Defense-in-depth, role model, secrets, PII | Yes, fully | Part I |
| 20 — Observability | Metric list, PII-log rule | Yes, fully | Part J |
| 21 — Testing | Test list incomplete | Yes, fully (as a plan) | Part K |
| 22 — Deployment | Hosting/scheduler undecided | Patterns: yes. Vendor choice: no | Part L — split |
| 1, 2 — DB access, own-store location | Explicit approvals | No — inherently the user's decision | Part M, unchanged |

---

## Part B — Identity, Final Specification

### `canonical_review_id`
- **Formula:** `SHA-256(platform || ':' || source_product_id || ':' || source_review_id)`, truncated to 128 bits, hex-encoded. Deterministic — regenerating from the same source triple always yields the same ID.
- **Why SHA-256:** Not because it fixes Flipkart's collision risk — it doesn't; that risk lives in the source's own input fields, not in digest strength (Phase 2.5 §2). SHA-256 is simply the better modern default for a value used as a primary key. A plain composite text key was the documented alternative; SHA-256 is chosen for fixed-length compactness in the platform's own indexes.
- **`identity_confidence`:** `native` (Myntra — marketplace's own permanent ID) or `derived` (Flipkart — synthetic, recomputed each crawl). Propagates into every AI evidence citation (Phase 2 §13).
- **Known limitation, documented not solved:** Flipkart's hash input includes a freshly-recomputed absolute date on every crawl; near a day/month rounding boundary the same physical review can resolve to two different `canonical_review_id`s across two crawls (Phase 2.5 final audit, §4C). Not fixable from this platform's side — the source-of-truth is upstream. Detected only as a symptom (an unexplained near-duplicate), not prevented.
- **Collision handling:** A genuine Flipkart collision (two distinct reviews, same author/day/rating/title) overwrites upstream before this platform ever sees it — undetectable as "two reviews," only detectable as a content-hash mismatch under one ID, logged to `identity_anomalies`. Cannot be recovered; can be observed.

### Supporting fields (additions since Phase 2 §3)
- **`source_row_id`:** Copy of `flipkart_reviews.id` / `myntra_reviews.id` — the source's own PK. Debugging/audit trail, and the fallback resync key if ever needed.
- **`ingested_at`:** When this platform's pipeline actually read the row — distinct from `source_updated_at` (when the source last touched it).
- **`mapper_version`:** Which version of the normalization mapper produced this row — lets a mapper bug's blast radius be queried precisely after the fact.

Nothing here is left undecided — this is the complete, final identity specification.

---

## Part C — Dates, Final Specification

| Field | Populated from | Purpose | Never used for |
|---|---|---|---|
| `review_date` | Source `review_date`, both platforms | **Every business analysis window** — 30-day, 90-day, 6-month, 1-year. The only date dashboard queries ever filter on. | Ingestion cursoring. |
| Source `createdAt` | Source table, set once on source INSERT, never touched again (verified, Phase 2.6) | Reference only — when the source first captured the review. Not used by this platform's cursors (unindexed on both tables; `id` serves the same purpose and is indexed). | Any cursor or business logic. |
| Source `updatedAt` → `source_updated_at` | Source table, bumped on every re-crawl unconditionally (verified, Phase 2.6) | Descriptive metadata only; available as a fallback candidacy filter (Phase 2.7 §2) if ever needed. | **New-review detection. Change detection. Any cursor.** |
| `reviewed_at` | Myntra only — true timestamp | Sub-day precision where explicitly Myntra-scoped; never a cross-platform capability. | Flipkart data (doesn't exist there) or ingestion cursoring. |
| `ingested_at` | This platform's own clock, at read time | Pipeline observability/audit (Part B). | Business analysis. |
| `processed_at` | This platform's own clock, at intelligence-classification time (`review_intelligence`) | Distinguishes "ingested" from "classified" — useful for pipeline-lag observability. | Business analysis. |

### Confidence propagation (closes Phase 2.5's §5 finding)
`product_metrics_daily` gains `day_confidence_review_count` and `month_confidence_review_count` per window — so the API and frontend can state precisely how much of a 30-day figure rests on exact-day Myntra/recent-Flipkart data versus reconstructed month-anchored older-Flipkart data, closing the gap between what Phase 2 §5 promised the UI could show and what the data model actually carried.

### Late-arriving reviews
Handled entirely by Track B's bounded reconciliation window (Phase 2.8 §5) — a review whose `review_date` falls inside the active window but wasn't caught by Track A's `id` cursor (e.g. a source-side backfill or correction) is picked up on the next reconciliation pass regardless. No separate mechanism needed.

### Timezone
Unchanged, restated: all window boundaries computed on IST calendar days, matching both crawlers' own `TZ=Asia/Kolkata` convention (verified directly in both packages' npm scripts).

---

## Part D — Data Model, Final Specification

The seven entities called out, fully specified. Entities not listed here are unchanged from Phase 2 §7 and need no further design work.

### `normalized_reviews`
- **Purpose:** Canonical, deduplicated, validated review — every downstream stage's only input.
- **PK:** `canonical_review_id`
- **Unique:** `(platform, source_product_id, source_review_id)`
- **FK:** None to source tables (none exist upstream either, Phase 1 finding) — application-enforced join on `platform_product_key` to `products`.
- **Nullable:** `title`, `review_text`, `reviewed_at`, `verified_purchase`, all Myntra-only image/size/color fields, `helpful_count`/`not_helpful_count` where not applicable to a platform — all per Phase 2 §3's common/marketplace-specific split.
- **Indexes:** `(platform, source_product_id)` for product-scoped reads; `content_hash` not indexed (only read by direct PK lookup, per reconciliation design).
- **Retention:** Full, permanent — mirrors source retention.
- **Refresh:** Track A (insert-only) + Track B (upsert-if-changed), Phase 2.8.
- **Idempotency:** Guaranteed by deterministic PK + hash-gated writes.

### `ingestion_watermarks`
- **Purpose:** Two-track cursor + job-lock state (Phase 2.8 §4) — fully finalized there, restated here for completeness.
- **PK:** `platform`
- **Fields:** `last_seen_source_id`, `last_reconciliation_run_at`, `last_reconciliation_rows_scanned`, `last_reconciliation_rows_changed`, `status`, `lock_acquired_at`.
- **Retention:** Current state only — one row per platform, no history.

### `review_intelligence`
- **Purpose:** Per-review sentiment/theme/complaint annotations.
- **PK:** `canonical_review_id` (1:1 with `normalized_reviews`)
- **Nullable:** All classification fields, when the source review has no text (rating-only) — see Part G's minimum-text-length gate.
- **Indexes:** `processing_status` partial index (only rows pending reprocessing — small, since most rows are `complete` at any time) for the classification job's own work queue.
- **Refresh:** Only when `content_hash` changes or `model_version`/`prompt_version` is stale relative to current — precedence rule: content-hash changes always win and reprocess immediately; version-driven reprocessing is a separate, explicitly-triggered batch job that never runs implicitly inside the daily reconciliation pass (resolves the Phase 2.5 §21 contradiction).

### `theme_metrics_daily`
- **Purpose:** Per-product, per-theme daily frequency/severity.
- **PK:** `(platform_product_key, theme_id, metric_date)`
- **Hard constraint:** **Sparse only** — a row is materialized if and only if `mention_count > 0` for that exact combination on that exact day. The aggregation job must never emit a dense cross-product of all products × all themes × all days. This is the fix that keeps this table from exceeding `normalized_reviews` in row count within a year (Phase 2.5 final audit, §7).
- **Indexes:** `(theme_id, metric_date)` for the cross-product Problems page query.

### `product_metrics_daily`
- **Purpose:** Deterministic daily rollup per product — every dashboard read's base unit.
- **PK:** `(platform_product_key, metric_date)`
- **New fields (Part C):** `day_confidence_review_count`, `month_confidence_review_count`.
- **Indexes:** `(metric_date)` for cross-product Executive Dashboard aggregation; existing PK covers product-scoped reads.

### `ai_insights`
- **Purpose:** Cached AI narrative with resolved evidence and a precisely-defined confidence field (Part G).
- **PK:** `insight_id` (uuid)
- **Unique:** `(platform_product_key, insight_type, period_key, input_hash)`
- **`confidence`:** Enum `low`/`medium`/`high`, mirroring the deterministic root-cause evidence tier — written by platform code, never by the model (Part G).
- **New fields:** `model_version` (dated snapshot string) and `prompt_version` (internal counter) tracked as two independent columns, not conflated (Phase 2.5 final audit, §13).

### `identity_anomalies`
- **Purpose:** Log of detected content-drift-under-same-ID (Flipkart collision symptoms).
- **PK:** `anomaly_id`
- **Documented scope limit:** Catches collisions (two reviews, one ID). Does *not* catch identity instability (one review, two IDs, Part B) — that failure mode manifests as an unexplained near-duplicate row, not a hash mismatch, and has no detection mechanism today. Documented as a known gap, not silently assumed solved.

### N+1 / duplication check
No N+1 risk found in the data model itself — every cross-entity read in the API layer (Part H) is either a single indexed lookup or a batched `WHERE ... = ANY($ids)` query, never a per-row loop. No unnecessary duplication found beyond the intentional, harmless Track A/Track B overlap already documented (Phase 2.8 §3).

---

## Part E — Scale, Final Data-Access Pattern

| Concern | Final recommendation |
|---|---|
| Ingestion batch size | 5,000 rows/chunk, both tracks — small enough to keep transactions short, large enough to amortize round-trip overhead. |
| Keyset pagination | `id`-ordered throughout (both tracks) — never offset-based, avoids drift under concurrent writes. |
| Content-hashing cost | Computed in-process during the reconciliation read, over a small fixed field set — negligible relative to I/O cost at any scale considered here (1M–10M+). |
| Normalization throughput | Pure in-memory mapping, no I/O per row beyond the batch read/write — bounded entirely by DB round-trip time, not compute. |
| Intelligence processing | Batched AI calls (tens of reviews/call), cached by `content_hash` — cost scales with new/changed reviews only, per Phase 2 §13. |
| Aggregation strategy | Nightly full pass over the trailing 30-day window specifically (not full history) + intraday incremental for today's row — Phase 2.8 §5 already bounds this correctly. |
| Dashboard query strategy | Every user-facing read hits a precomputed daily/aggregate table — confirmed for every endpoint in Part H except the Analyst, explicitly scoped below. |
| Caching | Short-TTL response cache in front of cross-product aggregation endpoints only (Executive Dashboard, Rankings, Problems) — deferred infra decision (Q4) doesn't block correctness, only response latency under concurrent load. |
| Historical queries | `product_metrics_daily` retains full daily granularity; `trend_snapshots` downsamples to weekly beyond 90 days (Phase 2 §7, unchanged). |
| API pagination | Offset/limit with a hard-capped max page size on every list endpoint (Part H). |
| Concurrent jobs | Per-platform advisory lock (`ingestion_watermarks.status`) prevents Track A/B or repeated runs from racing (Phase 2.8 §4). |
| Memory usage | Bounded by batch size (5,000 rows in-memory at a time), not total corpus size — safe at any scale considered here. |
| Database indexes | Both source tables now fully cover the actual query patterns (Phase 2.8 §1); platform-owned tables need the Rankings-sort index called out in Part H. |

**AI Product Analyst — explicit scope** (closes Phase 2.5's §15/§20 contradiction). v1 retrieval is restricted to precomputed `review_intelligence` theme/sentiment tags and resolved evidence lookups by ID — never free-text or semantic search over raw `review_text` at scale. Full-text/vector search over raw text is explicitly deferred as a separate, later, explicitly-indexed capability, not assumed to already exist.

---

## Part F — Health Score, Final Formula

```
shrunk(metric) = (n / (n + k)) * observed(metric) + (k / (n + k)) * baseline(metric)

health_score = w1·shrunk(rating)
             + w2·shrunk(sentiment)
             + w3·(100 − shrunk(complaint_frequency))
             + w4·(100 − shrunk(complaint_severity))
             + w5·trend_modifier(gated by both periods' own n/(n+k))
```

| Component | Status |
|---|---|
| Formula structure (shrinkage, weighted sum, clipping, trend-gating) | **PASS** — technical default, finalized now |
| Weights `w1..w5` = 0.30/0.25/0.20/0.15/0.10 | **USER DECISION REQUIRED** — v1 placeholder, versioned |
| Shrinkage strength `k` = 20 (placeholder) | **DATA VERIFICATION REQUIRED** — calibrate against real review-count distribution |
| Category bucket boundaries (80/65/45/25) | **USER DECISION REQUIRED** — v1 placeholder, versioned |

The elegant property of shrinkage worth noting: at `n=0` (a brand-new product with zero reviews), the formula collapses cleanly to exactly the baseline/average score — no undefined value, no special-case branch needed. At high `n`, it converges to the raw observed rate, exactly as it should.

**Technical default vs. business sign-off, stated plainly:** the formula itself can be implemented today, under `formula_version=1`, using the placeholder numbers above — this is not blocked. What's blocked is treating those specific numbers as final; they're explicitly provisional pending review against real product samples once Phase 1 backfill exists (Q10, unchanged from Phase 2.5). `input_snapshot` (Phase 2 §7) already stores every raw and shrunk value alongside the weights and `k` used for any given score, so every number is explainable after the fact regardless of which version produced it.

---

## Part G — AI / Theme Boundary, Final

> **`ai_insights.confidence` — finally defined.** `confidence` is an enum (`low`/`medium`/`high`) copied verbatim from the deterministic root-cause evidence tier (Phase 2 §12 — itself computed from theme mention-share thresholds, review-count consistency, and multi-window stability). It is populated by platform code before and after the model call — **the model never generates this value**. Post-hoc validation lints the model's raw output text for self-assessed certainty language (regex for "confident," "definitely," "100%," numeric self-ratings) inconsistent with the assigned tier, and rejects/regenerates on a match. This closes the critical AI-safety gap carried since Phase 2.5.

**Deterministic/AI boundary, restated once more for finality:** deterministic code owns every count, percentage, trend, health score, and severity value, always. AI only ever narrates, summarizes, and hypothesizes over numbers it's handed — never computes one. Every concrete claim resolves to a validated `canonical_review_id` citation actually present in the input evidence bundle (Phase 2 §13, unchanged, confirmed sound across three review passes).

| Item | Status |
|---|---|
| Confidence field definition | **PASS** — finalized above |
| Model/prompt versioning (two independent axes) | **PASS** — `model_version` + `prompt_version` columns, Part D |
| Taxonomy design (data not code, category groups, candidate queue) | **PASS** — unchanged from Phase 2 §11 |
| Taxonomy versioning migration path | **PASS** — theme edits (rename/split/merge) create a new `theme_id`; old `review_themes` rows are re-tagged by a scoped, explicitly-triggered reclassification batch, never silently orphaned |
| Minimum-text-length gate before classification | **PASS** — reviews under a small fixed character threshold skip AI classification entirely, flagged `processing_status='insufficient_text'` rather than force-classified |
| Hinglish / multilingual classification accuracy | **DATA VERIFICATION REQUIRED** — needs real review-text samples to evaluate against; a Phase 4 gate, not a design gap |

---

## Part H — API, Final

The full endpoint set is unchanged from Phase 2 §18 in shape; three fixes are now written in as implementation requirements, not review notes:

- **Rankings index:** `(score_date, formula_version, score DESC)` on `product_health_scores` — required before `GET /v1/products/rankings` ships.
- **N+1 prevention:** every evidence-resolution step (Product Detail, AI Insights) must use a single batched `WHERE canonical_review_id = ANY($ids)` query — never a per-ID loop. Stated here as a hard implementation constraint, not a suggestion.
- **Regeneration status:** `POST /v1/products/:key/insights/regenerate` returns a `job_id`; a new `GET /v1/jobs/:job_id` endpoint lets the frontend poll status instead of guessing via repeated `GET /insights` calls.

Pagination (offset/limit, hard-capped page size), server-driven sort/filter, caching strategy per endpoint, and authorization requirements are unchanged from Phase 2 §18 and the role model finalized in Part I below.

---

## Part I — Security, Defense in Depth, Finalized

### Structural write-prevention — five layers

| Layer | Mechanism |
|---|---|
| 1 — Database role | `review_intel_ro`, `SELECT`-only grants on the five source/product tables (Phase 2 §21) — the ultimate backstop, enforced by Postgres itself regardless of what application code does. |
| 2 — Code structure | `database/prodReadOnly/` exposes only a small set of pre-defined, parameterized read functions built on the raw `pg` driver — no Sequelize `Model` class with `create`/`update`/`destroy`/`sync` is ever imported into this module. There is no code path capable of constructing a write statement. |
| 3 — Static check | A CI check scans every file under `database/prodReadOnly/` for the substrings `INSERT INTO`, `UPDATE `, `DELETE FROM`, `TRUNCATE`, `ALTER TABLE`, `DROP ` (case-insensitive) and fails the build on a match — catches what code review might miss. |
| 4 — Startup assertion | On boot, compare `prodReadOnly` and `appStore` connection configs' host/database/user; refuse to start if identical — catches a copy-paste config mistake immediately, not in production. |
| 5 — Production canary | A scheduled job periodically attempts a harmless write through the read-only credentials and **alerts loudly if it ever succeeds** — turns the Phase 0 one-time permission test into an ongoing safeguard against role drift. |

### Role model
`viewer` (every `GET` endpoint) and `analyst` (everything `viewer` has, plus `POST /insights/regenerate` and `PATCH /early-warnings/:id` — the only two write-capable endpoints in the entire surface, both writing only to this platform's own store). No finer split is justified by a two-endpoint write surface. Who holds `analyst` remains Q13, an org decision.

### Everything else, finalized
- **Secrets:** `DB_PROD_*` (read-only role), `DB_APP_*` (own store), `AI_PROVIDER_API_KEY`, `CACHE_URL` (if Q4 adopts one), `NODE_ENV`, `PORT`, `LOG_LEVEL` — env vars, never committed, populated into `backend/.env.example` as names only when Phase 1 starts.
- **CORS/Helmet:** already dependencies (Phase 1 discovery) — Helmet defaults on; CORS restricted to the known frontend origin(s), no wildcard.
- **Rate limiting:** per-token on every endpoint; a materially tighter limit on the Analyst endpoint given its live, uncached cost profile.
- **SQL injection:** every query, both connections, parameterized — no string concatenation into SQL, anywhere, without exception.
- **Prompt injection:** review text and theme/product labels confined to clearly delimited "evidence" blocks in every prompt, with explicit instructions that content inside is data, not instructions (Phase 2 §13, extended in Phase 2.5 to cover labels too).
- **AI output validation:** schema-constrained structured output, citation validation against the actual evidence bundle, confidence-language lint (this Part) — all already specified.
- **PII/audit logging:** see Part J.

---

## Part J — Observability, Final

**Metrics tracked per ingestion run:** rows discovered (Track A), rows inserted, rows changed (Track B), rows skipped/rejected, reconciliation rows scanned, reconciliation rows changed, hash mismatches, identity anomalies logged, processing failures (with reason), AI call failures (with reason), per-stage latency, database errors, total job duration — all per platform, per run, correlated by a run ID.

> **PII rule — finalized.** Logs may reference `canonical_review_id`, `platform`, `platform_product_key`, numeric/boolean/enum field values, and error class/message text. Logs must **never** include `review_text`, `title`, `author_name`, or any other raw field that could carry user-submitted free text — enforced by a lint rule over logging call sites, not just a written policy.

---

## Part K — Testing, Final Plan

| Category | Coverage |
|---|---|
| Unit | Mappers, validators, canonical-ID hashing, content-hashing, health-score formula (including shrinkage), date/confidence logic. |
| Repository | Every `prodReadOnly` query function against a seeded fixture mirroring the verified live schema. |
| Normalization | Both platforms' field mappings, common vs. marketplace-specific handling. |
| Identity | Composite key uniqueness, `identity_confidence` assignment, the date-boundary-instability scenario (Part B) — confirm non-catastrophic behavior even though not perfectly deduplicated. |
| Hash | `canonical_review_id` determinism (same input → same output, always); `content_hash` sensitivity (any tracked field change → different hash) and stability (untracked field change → same hash). |
| Date | IST midnight boundaries, day/month confidence assignment, window-comparison symmetry. |
| Ingestion (Track A) | `id`-cursor correctness, chunking, atomic checkpoint advance. |
| Checkpoint | Advance-only-on-commit; job-lock prevents concurrent runs; stale-lock timeout releases correctly. |
| Crash/restart | See the six explicit proof-tests below. |
| Duplicate | Same source row submitted twice in one batch handled by in-batch dedup, matching the crawler's own established pattern. |
| Reconciliation (Track B) | Window computation, hash comparison branches (no-op / insert / update), `identity_anomalies` triggering on wholesale-change patterns. |
| Idempotency | Full pipeline run twice, byte-identical resulting state. |
| API | Contract tests per endpoint; pagination/sort/filter correctness; the new job-status endpoint. |
| Security | `viewer`/`analyst` authorization boundaries; rate limits; the five defense-in-depth layers (Part I), each independently tested. |
| AI evidence validation | Citation-existence, citation-membership-in-bundle, confidence-language lint (Part G) — all as automated regression tests, not manual spot checks. |
| Performance | Aggregation job timing and API p95 at synthetic 1M/10M fixture scale. |
| Load | Analyst endpoint under burst concurrent load, rate-limit behavior under it. |
| Production-read-only safety | The permission-boundary test (below) plus a static-analysis test asserting layer 3 (Part I) actually runs in CI. |

### The six explicit proof-tests requested

1. **Source tables never written:** run the full pipeline against a fixture role holding *only* SELECT grants; assert it completes successfully with zero permission errors (proving no code path ever attempts a write) — paired with the static CI check as a second, independent guarantee.
2. **Rerunning does not duplicate:** run Track A twice over an identical `id` range; assert row count and content are unchanged after the second run.
3. **Crash after DB write, before checkpoint:** commit a batch, kill the process before the watermark advances, restart; assert the batch reprocesses without corrupting state (idempotent upsert absorbs the repeat).
4. **Crash before DB write:** inject a failure mid-batch-write; assert the watermark did *not* advance, so the next run retries the same range from scratch.
5. **Reconciliation safe to rerun:** run Track B twice back-to-back with no source changes between runs; assert zero rows change on the second run.
6. **Unchanged reviews don't trigger reprocessing:** a source row whose `updatedAt` changes but whose tracked field values don't; assert `content_hash` comparison correctly no-ops — the single most important test in this list, since it's the direct proof that the Phase 2.6 redesign actually behaves as intended.

---

## Part L — Deployment

### Patterns — finalized regardless of vendor
- **Migrations:** explicit, tracked SQL up/down files (a lightweight tool, not Sequelize's `sync`) — even for this platform's own database. Keeps the "never silently alter schema" discipline consistent everywhere, not only against production.
- **Rollback:** every migration has a tested `down` path before being applied; application deploys support reverting to the previous build.
- **Health checks:** `/healthz` — both DB connections reachable, last successful Track A/Track B run within an expected freshness SLA.
- **Graceful shutdown:** SIGTERM drains in-flight HTTP requests and lets an in-progress ingestion batch finish or checkpoint cleanly before exit — a deploy must never corrupt an in-flight run, which the job-lock design already supports.

### Hosting / scheduler — recommendation, not a decision
No existing deployment convention was found in either sibling crawler repo (no Docker/PM2/k8s config) to infer an organizational default from — **NOT VERIFIED**. Reasoned recommendation, given this is an internal analytics tool, not a public high-traffic service:
- **Scheduler/worker:** **pg-boss** — a Postgres-backed job queue. It reuses the database already in the stack, and its built-in job locking directly satisfies the concurrency-control requirement (Phase 2.8 §4) without adding Redis or another piece of infrastructure just for this.
- **Backend:** a single small managed compute instance or lightweight container service — not a Kubernetes cluster, which would be unjustified complexity at this scale and team size.
- **Frontend:** a static build on a CDN/static host — simple, cheap, appropriate for an internal dashboard.

| Item | Status |
|---|---|
| Migrations, rollback, health checks, graceful shutdown patterns | **PASS** — vendor-independent, finalized |
| Actual hosting platform, scheduler choice | **USER DECISION REQUIRED** — Q5, Q8, recommendation given above |

---

## Part M — Final Implementation Gate

| Gate | Status | Evidence | Required Action |
|---|---|---|---|
| Production DB read-only role | **USER APPROVAL REQUIRED** | Design complete (Part I); not yet provisioned | Approve provisioning |
| Own writable DB location | **USER DECISION REQUIRED** | Design sound; location undecided (Q2) | Choose location |
| No-production-writes structural guarantee | **PASS** | Five-layer design finalized, Part I | Implement layers 2–5 in Phase 1 |
| Source schema verification | **PASS** | Verified from code and live DB, repeatedly, across five prior documents | None |
| Identity strategy | **PASS** | Complete final spec, Part B | None |
| Date strategy | **PASS** | Complete final spec, Part C | None |
| Ingestion strategy | **PASS** | Finalized in Phase 2.8, unchanged, approved by user | None |
| Watermark / checkpoint strategy | **PASS** | Finalized in Phase 2.8 | None |
| Idempotency | **PASS** | Unchanged, sound throughout | None |
| Data model | **PASS** | Complete final spec, Part D, including sparsity constraint | None |
| Indexes | **PASS** | Both platforms symmetric, live-verified (Phase 2.8); Rankings index specified (Part H) | None |
| Scalability | **PASS** | Final access pattern, Part E, including explicit Analyst scoping | None |
| Health score — formula design | **PASS** | Shrinkage-based formula finalized, Part F | None |
| Health score — weight/k calibration | **DATA VERIFICATION REQUIRED** | Placeholders are implementable now, versioned | Calibrate post-Phase-1-backfill (Q10) |
| Confidence mechanism | **PASS** | Continuous shrinkage weight, Part F — narrows prior "10/30 bucket" gap substantially | None |
| Theme taxonomy — design | **PASS** | Part G — taxonomy, versioning path, minimum-text gate all finalized | None |
| Theme taxonomy — Hinglish accuracy | **DATA VERIFICATION REQUIRED** | Needs real text samples | Evaluate at Phase 4 |
| AI safety — confidence field | **PASS** | Finally, precisely defined, Part G | None |
| Evidence validation | **PASS** | Sound across every prior pass | None |
| API | **PASS** | Index, N+1 rule, job-status endpoint all specified, Part H | None |
| Security | **PASS** | Five-layer defense-in-depth, role model, secrets list all finalized, Part I | None (implementation-time work) |
| Observability | **PASS** | Complete metric list + enforced PII rule, Part J | None |
| Testing | **PASS** | Complete plan including six explicit proof-tests, Part K | None (execution happens during implementation) |
| Deployment — patterns | **PASS** | Migrations/rollback/health/shutdown finalized, vendor-independent, Part L | None |
| Deployment — hosting/scheduler choice | **USER DECISION REQUIRED** | Recommendation given (pg-boss + small compute + static frontend), Part L | Choose or approve the recommendation |
| AI provider/budget | **USER DECISION REQUIRED** | Recommendation given previously (Anthropic, tiered) | Confirm (Q3) |
| Dashboard auth / who holds analyst role | **USER DECISION REQUIRED** | Role model finalized, Part I; specific people/teams undecided | Name them (Q6, Q13) |
| Frontend framework | **USER DECISION REQUIRED** | Recommendation given previously (React + Vite) | Confirm (Q7) |
| Caching infra | **USER DECISION REQUIRED** | Recommendation: defer until real traffic justifies it (Q4) | Confirm or override |
| Cross-platform product mapping | **NOT APPLICABLE** | Resolved — brand-level only, by design, no further decision needed (Q12) | None |
| Future-marketplace scope | **NOT APPLICABLE** | Resolved — existing abstraction sufficient, no further investment needed (Q9) | None |
| Early-warning thresholds | **DATA VERIFICATION REQUIRED** | Design sound (Phase 2 §16); numeric thresholds need real variance data | Tune at Phase 5 (Q11) |
| Documentation | **PASS** | Nine documents now published to `docs/architecture/`, full decision history including corrections preserved | None |

### 1. What is completely finalized
Ingestion (all tracks, cursors, checkpoints), identity, dates, the full data model (all entities), scalability/access patterns, the health-score formula structure, the deterministic/AI boundary and confidence-field definition, the theme-taxonomy design, the full API surface, the five-layer security design and role model, observability, the complete test plan, and all vendor-independent deployment patterns. This is the large majority of the architecture.

### 2. What still requires your decision
Own-store DB location (Q2), AI provider/budget confirmation (Q3), caching infra (Q4), hosting/scheduler choice (Q5/Q8, recommendation given), who holds the `analyst` role (Q6/Q13), frontend framework confirmation (Q7).

### 3. What still requires production-data verification
Health-score weight and shrinkage-constant (`k`) calibration, Hinglish/multilingual classification accuracy, early-warning threshold tuning — all genuinely need real post-backfill data and cannot be shortcut by more design work.

### 4. What requires DB approval
Only the read-only role provisioning (gate 1) — the one item still outstanding from the original production-safety chain. No further index or schema changes are anticipated or requested at this stage.

### 5. What can be implemented immediately after approval
Once the read-only role exists: the full Phase 1 ingestion pipeline (Parts B–E), the security defense-in-depth layers (Part I), observability (Part J), and the test suite (Part K) — none of these wait on any other open decision.

### 6. Exact implementation order
1. Read-only role provisioning (gate 1) + own-store location decision (Q2) — unblocks everything.
2. Phase 1: ingestion (Track A + Track B), normalization, validation, identity/date handling — per Parts B–E.
3. Security layers 2–5 (Part I) built alongside Phase 1, not after — they're cheap to add now and expensive to retrofit.
4. Observability (Part J) built alongside Phase 1 — same reasoning.
5. Deterministic metrics base (Phase 2 roadmap Phase 2) — no changes to this step from prior planning.
6. Health scoring with the finalized shrinkage formula, v1 placeholder weights (Part F) — real calibration follows once data exists, without blocking initial deployment.
7. AI-assisted intelligence (Phase 4) — gated on AI provider decision (Q3) and cost validation on a sample, as previously planned.
8. Early warning + marketplace comparison, API, frontend, hardening — unchanged from the prior roadmap's remaining phases.

---

*Architecture only — no application code, database objects, or crawler code were created or modified. This is the most complete state the design has reached; awaiting approval before Phase 1 implementation begins.*

*Source: [Final pre-implementation architecture artifact](https://claude.ai/code/artifact/5919fba2-b167-4cd0-9751-5e269b5bd4b3)*
