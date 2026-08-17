# Product Review Intelligence Platform — Phase 1 Final Plan

**Final Plan · Revision 4 · Nothing Created Yet · Awaiting "APPROVE PHASE 1 IMPLEMENTATION"**

TypeScript now approved for the backend. Exact `content_hash` field spec, a local schema recommendation, and an honest concurrency analysis of the `id` cursor were closed out in revision 3. This revision fixes a real design flaw — a canary that attempted a write against production to prove it would fail — and closes the schema decision.

- 2026-08-11
- Files created: 0
- Dependencies installed: 0
- Backend language: TypeScript
- Local schema: `product_review_intelligence` — **approved**

---

## Correction: The Production Write Canary

> **This was a real flaw, not a style preference.** The prior revision proposed a canary that periodically attempts a harmless write through `review_intel_ro`, alerting if it ever succeeds. The problem: in exactly the failure mode this exists to catch — the role accidentally over-provisioned with write access — the canary's own write attempt *is* the accident. Catching it after the fact doesn't undo it. A monitoring mechanism must never itself be capable of causing the thing it exists to detect. Removed entirely; replaced with a read-only canary in §C below.

---

## A. Final Phase 1 Architecture

Two independent database connections (`prodReadOnly`, raw `pg`, SELECT-only, two tables; `appStore`, Sequelize, full control, local-only) feeding a two-track ingestion pipeline (Track A: new-row keyset scan by `id`; Track B: bounded `review_date` reconciliation by content hash) into four local application tables, wrapped in five defense-in-depth security layers and a nine-test safety suite. No frontend, no AI, no analytics — this phase proves ingestion is correct and stops.

---

## B. Database Separation Diagram

```
PRODUCTION DB  (review_intel_ro, SELECT only, 2 tables)
    │
    │  SELECT only — never held open across a write
    ▼
Application memory
    │  normalize → validate → compute content_hash
    ▼
APP STORE TRANSACTION  (local Postgres, full control)
    │
    ├── upsert normalized_reviews
    ├── (Track B only) upsert identity_anomalies / ingestion_rejects if applicable
    └── advance watermark
    │
  COMMIT
    (watermark advances if and only if this transaction commits)
```

No distributed transaction, no open production transaction spanning the application write — the production `SELECT` completes and its connection is released before the application-store transaction even opens. The two databases never participate in the same transaction; correctness across the boundary comes entirely from idempotent, hash-gated writes plus the checkpoint-after-commit rule (§I), not from any cross-database atomicity guarantee.

---

## C. Production Read-Only Security Model

| Layer | Mechanism |
|---|---|
| 1 — Role | `review_intel_ro`: `GRANT SELECT ON "DataWarehouse".flipkart_reviews, "DataWarehouse".myntra_reviews TO review_intel_ro;` — nothing else, no other table, already created and verified. |
| 2 — Code structure | `database/prodReadOnly/index.ts` exports exactly four functions, nothing else — no generic query executor, no dynamic table name, ever. |
| 3 — Static check | CI scan of `database/prodReadOnly/**` for write-shaped SQL keywords; build fails on a match. |
| 4 — Startup assertion | Refuses to boot if `prodReadOnly` and `appStore` configs resolve to the same host+database+user. |
| 5 — Canary **[corrected]** | **Read-only.** A scheduled probe that only ever reads, never attempts to write, against production. |

```ts
// database/prodReadOnly/index.ts — the entire exported surface
export {
  getFlipkartReviewsPage,          // Track A
  getFlipkartReviewsByDateWindow,  // Track B
  getMyntraReviewsPage,
  getMyntraReviewsByDateWindow,
};
```

```ts
// security/canary.ts — every check is a read, nothing else
async function runCanary() {
  const identity = await pool.query('SELECT current_user AS "user", current_database() AS db');
  assert(identity.rows[0].user === config.prodReadOnly.user);       // expected role
  assert(identity.rows[0].db === config.prodReadOnly.database);      // expected database

  await pool.query('SELECT 1');                                     // connectivity

  // Reuses the SAME fixed-surface functions Track A/B call — no new query shape,
  // no new code path, and existence + read-access are proven in one motion.
  await getFlipkartReviewsPage(0, 1);   // tiny page, proves the table is reachable
  await getMyntraReviewsPage(0, 1);

  // No INSERT / UPDATE / DELETE / TRUNCATE / DDL — never, under any condition.
}
```

**What this trades away, stated plainly:** it can no longer directly prove the role rejects writes — only that reads succeed and identity/connectivity are as expected. That's the correct trade: proving write-rejection would require attempting a write, which the absolute safety rule forbids regardless of expected outcome. Write-rejection is verified two other ways instead — a local role that mirrors `review_intel_ro`'s grants exactly, tested freely (§J), and the DBA's own review of the role's actual grants at provisioning time, outside this application's responsibility.

---

## D. Local Application-Store Model

> **Schema — approved.** `product_review_intelligence`, confirmed, no longer an open decision. Reasoning that led here: every prior document in this series uses "`DataWarehouse`" to mean exactly one thing — the read-only production source — so reusing that name for writable local tables would blur a distinction the whole architecture is built around, even though it's technically harmless locally (different host). A plain lowercase schema name also avoids the double-quoting friction `DataWarehouse`'s mixed case requires in every SQL statement.

Final local layout:

```
gbl_data_lake  (local Postgres, host=localhost)
    └── product_review_intelligence   ← all application-owned tables
        ├── ingestion_watermarks
        ├── normalized_reviews
        ├── identity_anomalies
        └── ingestion_rejects
    └── DataWarehouse                  ← reserved for source-shaped local fixtures only, if built
```

Local role: the `postgres` superuser, on `localhost` only, full control — a disposable sandbox, not a security boundary. This is the only database where `CREATE TABLE`, `CREATE INDEX`, migrations, and test-data writes/deletes are ever allowed.

---

## E. Final Environment Configuration

```
# ── Local application store — writable, dev/test only ────────────────
DB_DIALECT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gbl_data_lake
DB_USER=postgres
DB_PASSWORD=                          # .env only — never committed
DB_SCHEMA=product_review_intelligence # approved — see §D

# ── Production source — READ ONLY, review_intel_ro, 2 tables only ────
DB_PROD_HOST=
DB_PROD_PORT=5432
DB_PROD_NAME=gbl_data_lake
DB_PROD_SCHEMA=DataWarehouse
DB_PROD_USER=review_intel_ro
DB_PROD_PASSWORD=

NODE_ENV=development
PORT=4000
LOG_LEVEL=info

INGEST_BATCH_SIZE=5000
RECONCILE_LOOKBACK_DAYS=60
RECONCILE_SAFETY_BUFFER_DAYS=10
```

Unchanged in shape from revision 2 — TypeScript doesn't add or remove any environment variable, only changes how the config module that reads them is written (§F).

---

## F. Final Folder Structure — TypeScript

Revised in full. New tooling: `typescript`, `@types/node`, `@types/express`, `@types/cors`, `@types/pg` (dependencies for types); `tsx` for fast dev execution (replaces `nodemon`'s role — runs `.ts` directly without a separate build step); `tsc` compiles to `dist/` for anything resembling a production run. `zod`, `vitest`, and `node-pg-migrate` are all TypeScript-native already, no extra types package needed.

```
backend/
  tsconfig.json                          strict: true, target ES2022, module NodeNext
  migrations/
    001_create_ingestion_watermarks.sql
    002_create_normalized_reviews.sql
    003_create_identity_anomalies.sql
    004_create_ingestion_rejects.sql
  src/
    config/
      index.ts                          Zod-validated env → typed config object
      assertLocalMigrationTarget.ts
    types/
      unifiedReview.ts                   the canonical review shape (§H), shared by both mappers
    database/
      prodReadOnly/
        client.ts                        raw `pg` Pool, DB_PROD_* only
        flipkartReviewsRepo.ts
        myntraReviewsRepo.ts
        index.ts                          fixed 4-function export surface (§C)
      appStore/
        client.ts                          Sequelize instance, DB_* only
        models/
          ingestionWatermark.ts
          normalizedReview.ts
          identityAnomaly.ts
          ingestionReject.ts
      fixtures/
        flipkartReviewsFixture.sql
        myntraReviewsFixture.sql
    modules/
      ingestion/
        shared/
          canonicalId.ts
          contentHash.ts                    exact field spec, §H
          validators.ts
        flipkart/
          mapper.ts
        myntra/
          mapper.ts
        trackA.ts
        trackB.ts
        watermarkRepo.ts
        runIngestion.ts                       CLI entrypoint
    security/
      prodReadOnlyGuard.ts
      canary.ts
    shared/
      logger.ts
      errors.ts
  scripts/
    checkNoWrites.ts
  tests/
    unit/ · integration/ · security/
  .gitignore
  package.json
  .env.example
```

---

## G. Track A — New Rows

```
WHERE id > $last_seen_source_id ORDER BY id LIMIT $batch_size  -- 5000
```

> **Monotonicity — verified in part, not fully.** What's actually verified from code: both tables' `id` is a standard Postgres autoincrement (Sequelize `autoIncrement: true` → a sequence-backed column). Postgres sequences guarantee each allocated value is unique and increasing — that part is a Postgres fact, not an assumption.
>
> What's **not** verified: whether *commit order* always matches *id-allocation order*. Under a single sequential writer (each crawl run is one `bulkCreate` transaction, executed one after another), it does. Under concurrent writers, Postgres does not guarantee it — a transaction that allocates a higher id could commit before one allocating a lower id, which would let a `WHERE id > last_seen` cursor skip the lower-id row permanently once the watermark passes it. Whether the crawlers ever run as overlapping/concurrent processes remains **REQUIRES VERIFICATION** — flagged in the Phase 2.5 review and still not resolved, since it depends on scheduling infrastructure outside both crawler repos.
>
> **Why this doesn't leave a silent gap in practice:** Track B independently re-scans the entire bounded `review_date` window on every run and inserts any row it finds missing (§H) — so a row Track A's cursor ever skipped is still caught, as long as its `review_date` falls inside the reconciliation window, which any freshly-inserted row's would. The residual gap is narrower than it first appears: only a very old backfill-style insert with both a late-arriving id *and* a `review_date` outside the reconciliation window would slip through both tracks — noted as a known limitation (§M), not silently assumed away.

Checkpoint rule, unchanged: `last_seen_source_id` advances only after the corresponding `appStore` transaction (insert + watermark update, one transaction) commits.

### Concurrency investigation — concluded

Checked directly: a scheduler exists on this machine (sibling repo `scheduler/`, PM2 + cron, with its own per-job locking utility) — but it registers exactly four jobs (`instamart_price_scraper`, `myntra_sjit_crawler`, `myntra_sor_crawler`, `myntra_ppmp_crawler`), confirmed by reading its `app.js` job registry directly. None of these are `flipkart-product-crawler` or `myntra-product-crawler` — a repo-name grep for either inside the scheduler repo returns zero matches. **There is no connection between this scheduler and the two review crawlers.**

This is a real, useful negative result: whatever actually triggers the review crawlers — manual invocation, a different mechanism, or nothing scheduled yet — isn't visible anywhere on this machine. The design still does not assume single-writer safety is guaranteed; whether `flipkart-product-crawler`/`myntra-product-crawler` can run as overlapping processes remains **REQUIRES VERIFICATION**, with Track B's independent re-scan as the safety net regardless of how that resolves.

---

## H. Track B — Reconciliation

```
WHERE review_date >= $window_start ORDER BY id  -- window_start = today − (60 + 10) days
```

### content_hash — exact field specification

**Included:**

| Field | Why |
|---|---|
| `rating`, `title`, `review_text` | Core review content — any change here is exactly what reprocessing exists to catch. |
| `helpful_count` (both), `not_helpful_count` (Myntra) | Meaningful, mutable engagement signal. |
| `brand` | Denormalized onto every review row upstream (both crawlers) — a real, tracked value. |
| `author` | Meaningful content *and* diagnostic: an author change under an unchanged `canonical_review_id` is exactly the symptom the Flipkart identity-collision detector needs to see (Phase 2.5 §4D) — excluding it would blind that detector. |
| Platform-specific: `verified_purchase` (Flipkart); `has_images`, `image_urls` (sorted before hashing), `size_purchased`, `color_purchased` (Myntra) | Real, tracked marketplace-specific fields. |

**Excluded:**

| Field | Why |
|---|---|
| `source_updated_at` | The entire reason this redesign exists — bumps unconditionally, would make every re-crawl look like a change. |
| `country` | Effectively constant (`'India'`, hardcoded upstream) — zero discriminating value. |
| `product_url` | Denormalized/derived, not reviewer-authored content; Myntra's specifically is runtime-templated upstream, not a stable stored value. |
| `ingested_at`, `processed_at`, any platform-internal bookkeeping field | This platform's own metadata, never source content. |

### Normalization rules before hashing

- Trim leading/trailing whitespace on every text field — a whitespace-only re-scrape artifact must never register as a content change.
- `null` and empty string normalize to the same sentinel value before hashing — avoids a null↔empty-string flip registering as a spurious change.
- Numeric fields hashed via their canonical string form.
- **`image_urls` is sorted before joining and hashing** — if Myntra's API ever returns the same images in a different array order between crawls, an unsorted hash would falsely flag "changed" for identical content. Sorting first eliminates that failure mode entirely.

### Branches

No existing row → normalize + insert (harmless overlap with Track A, §G). Existing row + hash match → no-op. Existing row + hash mismatch → update `normalized_reviews`, bump `content_hash`, flag for `review_intelligence` reprocessing (a later phase); a mismatch pattern that looks like a wholesale identity swap (author, title, rating all different at once) also writes `identity_anomalies`.

### ingestion_rejects — revised, no raw payload

Original design stored a full `raw_payload JSONB` per rejected row. Revised: store only the specific field(s) that caused the rejection, never the full row.

```sql
CREATE TABLE ingestion_rejects (
  reject_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            TEXT NOT NULL,
  source_row_id        BIGINT,          -- nullable: may be unknown if the row itself is malformed
  source_product_id     TEXT,
  source_review_id       TEXT,
  reason                   TEXT NOT NULL,   -- e.g. 'missing_rating' | 'invalid_date' | 'missing_product_id'
  failed_fields             JSONB NOT NULL,  -- ONLY the offending field(s) and raw values
  first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count              INTEGER NOT NULL DEFAULT 1
);
```

- **Exact fields:** `failed_fields` holds only the scalar value(s) relevant to `reason` — e.g. the raw unparseable date string, or the out-of-range rating value. `review_text` and `author_name` are never written here, regardless of reason.
- **Retention:** rolling ~90 days, matching the observability design already established (Phase 2 §7) — sufficient for debugging, not a permanent archive.
- **Access:** same internal/ops-only boundary as every other observability table — no separate exposure.
- **PII implication:** minimal by design — the only content ever stored is the one or two fields that failed validation (typically a date string or a numeric value), never free-text review content.
- **Max size:** a handful of scalar fields, not a full row — orders of magnitude smaller than the original raw-payload design.

**Field allowlist, explicit.** Checked against the actual Phase 1 validator rules (missing product/review ID, missing/invalid rating, unparseable date — none reference `review_text` or `author_name`): as designed, `failed_fields` could never capture free text under the current rule set. Restricting it structurally anyway, as defense-in-depth against a future validator being added carelessly:

```ts
type FailedFieldKey = 'sourceProductId' | 'sourceReviewId' | 'rating' | 'rawDateString' | 'platform';
// failed_fields is built from a typed record keyed ONLY by FailedFieldKey — the validator
// returns this typed structure, never a dump of the raw row. review_text and author_name
// are not members of this type, so they cannot enter this table even by accident.
```

---

## I. Transaction / Checkpoint Model

| Case | Guarantee |
|---|---|
| 1. Source SELECT succeeds, app write fails | Watermark untouched — the write and the watermark advance are the same transaction; if the write fails, that transaction never commits, so nothing advances. |
| 2. App transaction rolls back | No partial data — Postgres transactional guarantee, nothing this design has to enforce separately. |
| 3. App transaction commits, process crashes immediately after | Safe to rerun — deterministic `canonical_review_id` + upsert means reprocessing the same source rows converges to identical state. |
| 4. Reconciliation runs twice | No duplicates — same idempotent upsert; a second run with no source changes produces zero writes. |
| 5. `updatedAt` changes, content doesn't | No reprocessing — `content_hash` comparison never includes `updatedAt` (§H), so this is a no-op by construction, not by luck. |

---

## J. Test Matrix

| Category | Phase 1 applicable? | Coverage |
|---|---|---|
| Unit | Yes | Canonical ID/content-hash determinism, validators, mappers, config parsing, sort-before-hash for `image_urls`. |
| Normalization | Yes | Both platforms' field mappings against the unified type (§F). |
| Canonical identity | Yes | Composite key uniqueness, `identity_confidence` assignment. |
| Content hash | Yes | Exact field-inclusion test (§H) — sensitivity to tracked fields, stability under untracked-field-only changes. |
| Date handling | Yes | IST boundaries, `date_confidence` assignment. |
| Repository | Yes | Each `prodReadOnly` function against local fixtures. |
| Ingestion (Track A) | Yes | `id`-cursor correctness, chunking, checkpoint atomicity. |
| Reconciliation (Track B) | Yes | Window computation, all three hash-comparison branches. |
| Checkpointing | Yes | Advance-only-on-commit; lock acquire/release; stale-lock timeout. |
| Crash/restart | Yes | All five cases in §I, each as its own test. |
| Idempotency | Yes | Full pipeline run twice → byte-identical state. |
| Duplicate prevention | Yes | Same source row twice in one batch → in-batch dedup. |
| Security | Yes | The nine mandatory safety tests below. |
| Database separation | Yes | Distinct pool instances; no credential crossover (tests F–H below). |
| API contracts | **Not applicable** | No HTTP API exists in Phase 1 scope — deferred to the API-layer phase. |
| Performance | Yes, narrowly | Ingestion/reconciliation throughput against a synthetic fixture at scale — not HTTP request performance, since no server endpoint exists yet. |
| Load testing | **Not applicable** | No concurrent HTTP load to generate without an API — deferred. |

### Nine mandatory safety tests

1. **[corrected]** Production source tables never receive writes — proven **structurally**: `prodReadOnly`'s fixed export surface (§C layer 2) + the CI scan (layer 3). No write is ever attempted against real production to prove this — proof is structural, not experimental.
2. Migration cannot target production — `assertLocalMigrationTarget()` rejects a non-local host.
3. **[corrected]** `prodReadOnly` cannot write — proven against a **local** Postgres role whose grants mirror `review_intel_ro` exactly (SELECT-only on the local fixture tables); a real `INSERT` attempt against this local mirror is expected to fail, proving the grant model works, entirely on local infrastructure. Production is never touched by this test.
4. `prodReadOnly` cannot access an unauthorized table — `Object.keys()` on the module equals exactly the four allowed functions.
5. App-store migrations only affect the local/app DB — connection config sourced only from unprefixed `DB_*` vars, never `DB_PROD_*`.
6. Rerunning ingestion does not duplicate — Track A run twice over an identical range, unchanged row count.
7. Checkpoint cannot advance before commit — inject a mid-write failure, assert the watermark is untouched.
8. Reconciliation can safely rerun — Track B run twice back-to-back, zero changes on the second pass.
9. `updatedAt`-only changes do not cause false processing — case 5 in §I, as its own dedicated regression test.

---

## K. Definition of Done

Reported in exactly the Mandatory Development Rule's format: files created/changed, database objects created (local store only, itemized, with explicit confirmation none were created in production), exact source-DB queries used, confirmation every production interaction was `SELECT`-only against exactly two tables, full results for all sixteen applicable test categories including the nine named safety tests, coverage, ingestion/reconciliation performance against fixture data, checkpoint behavior observed, failures, and unresolved risks. Then stop and wait for explicit approval before Phase 2.

---

## L. Remaining Decisions

| Decision | Status |
|---|---|
| ~~Local schema name~~ | **Resolved** — `product_review_intelligence`, approved (§D) |
| Whether the id-cursor's unverified concurrency assumption (§G) is acceptable as-is, given Track B's redundancy, or whether extra margin should be added now rather than accepted as a documented residual risk | **USER DECISION REQUIRED** |
| Whether crawl scheduling ever runs overlapping/concurrent processes | **REQUIRES VERIFICATION** — confirmed no connection to the sibling `scheduler` repo; no other scheduling config found on this machine |

---

## M. Risks / Known Limitations

- **KNOWN LIMITATION** Flipkart's `canonical_review_id` can occasionally shift for the same physical review near a relative-date rounding boundary — documented since Phase 2.5, not fixable from this platform's side.
- **KNOWN LIMITATION** A very old backfill-style insert with both a late-arriving `id` and a `review_date` outside the reconciliation window could theoretically slip past both tracks (§G) — narrow, unobserved, and the only scenario Track B's redundancy doesn't cover.
- **KNOWN LIMITATION** `identity_anomalies` detects content-drift-under-same-ID; it does not detect the inverse (one review, two IDs) — same as previously documented.

---

## N. Exact Implementation Order

1. `tsconfig.json`, package.json updates, `.gitignore`, `.env.example`, Zod config module.
2. `assertLocalMigrationTarget.ts` — built and tested before any DB is touched.
3. Migration tool wired up; schema created (per §L's confirmed choice); fixtures + four app-owned tables migrated locally.
4. `appStore` Sequelize models + `prodReadOnly` fixed-surface client/repos, against local fixtures.
5. `canonicalId.ts`, `contentHash.ts` (exact spec, §H), validators — unit-tested alongside each.
6. Platform mappers.
7. Track A + tests.
8. Track B + tests, including `identity_anomalies`.
9. `watermarkRepo.ts` locking/checkpointing + crash-recovery tests.
10. All five security layers + the nine named safety tests.
11. Logger + PII guard.
12. Full integration/E2E run against fixtures; coverage report.

---

## O. Final Implementation Gate

| # | Item | Status |
|---|---|---|
| 1 | Local schema | **PASS** — `product_review_intelligence`, approved |
| 2 | Database separation | **PASS** |
| 3 | Production source allowlist | **PASS** — exactly two tables, structurally enforced |
| 4 | Production SELECT-only design | **PASS** |
| 5 | Production write canary removed | **PASS** |
| 6 | Read-only production canary | **PASS** |
| 7 | Track A id concurrency | **REQUIRES VERIFICATION** — no scheduling config found for either crawler on this machine; Track B remains the safety net regardless |
| 8 | Track B | **PASS** |
| 9 | content_hash | **PASS** — exact field spec, tests planned for every included/excluded field |
| 10 | Transaction/checkpoint | **PASS** |
| 11 | Tests | **PASS** — nine safety tests, two re-scoped this revision, none touch production destructively |
| 12 | Production role provisioning | **USER/DBA ACTION REQUIRED** — provisioning happens outside this application; not yet confirmed complete |

Additional items tracked from earlier revisions, unaffected by this correction: environment configuration, folder structure (TypeScript), migration safety mechanism, test matrix breadth, `ingestion_rejects` design, and Definition of Done format all remain **PASS**. Backend implementation itself remains **USER/DBA ACTION REQUIRED** pending your explicit "APPROVE PHASE 1 IMPLEMENTATION."

---

*Final plan only — zero files created, zero dependencies installed, zero migrations run, zero database connections made, zero writes ever attempted against production by design. Waiting for "APPROVE PHASE 1 IMPLEMENTATION" before writing any code.*

*Source: [Phase 1 final plan artifact](https://claude.ai/code/artifact/f1f8adc1-ddc3-48ff-8134-9c73c07ec30c) (revision 4)*
