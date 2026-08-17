# Phase 2 — Local End-to-End Ingestion & Reconciliation Validation Report

**Scope:** Local-only. Drives the real `runTrackA`/`runTrackB` code (no reimplementation) against the 100,000-row local production-like dataset from Phase 1.5, via a dedicated read-only local role. Production was never touched — see §confirmations at the end.

**Status vocabulary used below:** PASS / FAIL / REQUIRES VERIFICATION / KNOWN LIMITATION, per instruction. Nothing is marked PASS without evidence in this document.

---

## 1. Environment

- Source: `gbl_data_lake.DataWarehouse.flipkart_reviews` / `.myntra_reviews` (local Postgres, localhost:5432) — the Phase 1.5 dataset, plus controlled test-fixture rows added for this phase (enumerated in §2).
- Application: `gbl_data_lake.product_review_intelligence.*` — migrations were not yet applied to this real local database before this phase (only to the isolated `pri_test_appstore`); ran `npm run migrate` for the first time against it here. All 4 migrations applied cleanly.
- `config.prodReadOnly` was pointed at this local dataset via **shell-level environment variables on each command invocation only** (`DB_PROD_HOST=localhost DB_PROD_USER=local_dw_reader ...`) — never written to `.env`. Every other command in this project still sees the fail-loud `DB_PROD_HOST=unset.invalid` default.
- **New local role `local_dw_reader`**: created specifically for this phase, `GRANT SELECT`-only on the two target tables, nothing else. Required because `config.appStore` and `config.prodReadOnly` now legitimately point at the same physical local database (different schemas) — Security Layer 4 (`assertConnectionsAreDistinct`) correctly refused to start when both used `postgres`/`postgres`, since it can't distinguish schemas, only host+database+user. Using a distinct low-privilege role satisfied the guard *and* kept the read-only posture intact — the guard was not weakened.
- **PASS** — environment established correctly, no persistent config changes, no production access.

---

## 2. Source row counts & controlled test fixtures

| | Baseline (Phase 1.5) | Controlled fixtures added this phase | Total at start of Phase 2 |
|---|---|---|---|
| Flipkart source | 50,000 | +7 (tagged `PHASE2CTRL`/`777777`/`` empty pid) | 50,007 |
| Myntra source | 50,000 | +2 (tagged product_id `999001`/`777777`) | 50,002 |

Controlled fixture rows (all clearly tagged, never colliding with the 500 baseline products per platform):

| Purpose | Platform | Identifier | §Test |
|---|---|---|---|
| updatedAt-only | Flipkart | pid=`PHASE2CTRL`, review_id=`CTRL-UPDATEDAT-1` | §10 |
| content-change | Flipkart | pid=`PHASE2CTRL`, review_id=`CTRL-CONTENT-1` | §11 |
| rating-change | Myntra | product_id=`999001`, review_id=`CTRL-RATING-1` | §12 |
| new-review (inserted after first Track A run) | Flipkart | pid=`PHASE2CTRL`, review_id=`CTRL-NEWROW-1` | §13 |
| cross-platform identity | Flipkart + Myntra | product/pid=`777777`, review_id=`XPLAT-SHARED-1` (both platforms, identical strings) | §15 |
| malformed: rating out of range | Flipkart | review_id=`CTRL-MALFORMED-RATING`, rating=0 | §24 |
| malformed: empty product id | Flipkart | review_id=`CTRL-MALFORMED-PID`, pid=`''` | §24 |
| malformed: pre-2007 date | Flipkart | review_id=`CTRL-MALFORMED-DATE`, review_date=`2005-01-01` | §24 |

**PASS** — required fields, review_id/product_id uniqueness, rating validity, and `review_date`/`updatedAt` presence were confirmed on the 100,000-row baseline before any fixture rows were added (all fields 100% populated, ratings 100% in 1–5 range, id ranges exactly 1–50,000 each — see Phase 1.5 report for the full breakdown).

---

## 3. Verify source data

**PASS** — re-verified as part of §2's baseline spot-check: `min(id)=1, max(id)=50000` both platforms, 50,000 distinct `review_id`s, 0 missing `rating`/`review_date`/`updatedAt` prior to fixture additions.

---

## 4. Initial ingestion (Track A)

Run via the actual `runTrackA()` function, both platforms, real batch size (5,000):

| Platform | Batches | Rows read | Rows inserted | Rows rejected | Final watermark | Duration | Rows/sec |
|---|---|---|---|---|---|---|---|
| Flipkart | 11 | 50,007 | 50,004 | 3 | 50,007 | 12.66s | 3,951 |
| Myntra | 11 | 50,002 | 50,002 | 0 | 50,002 | 13.15s | 3,801 |

Peak memory during Flipkart Track A: 478MB RSS / 304MB heap (see §22/§23 for full performance/memory detail).

**PASS.**

---

## 5. Track A completeness

| Platform | Source | Normalized | Rejected | Accounted for | Difference |
|---|---|---|---|---|---|
| Flipkart | 50,007 | 50,004 | 3 | 50,007 | **0** |
| Myntra | 50,002 | 50,002 | 0 | 50,002 | **0** |

Flipkart's 3 rejects, fully classified (no unexplained difference):

| Reason | Count |
|---|---|
| `invalid_rating` | 1 (`CTRL-MALFORMED-RATING`, rating=0) |
| `missing_product_id` | 1 (`CTRL-MALFORMED-PID`, pid=`''`) |
| `invalid_date` | 1 (`CTRL-MALFORMED-DATE`, review_date before 2007 cutoff) |

**PASS** — every source row is accounted for as either normalized or rejected-with-reason, measured immediately after Track A alone (before Track B ran and altered the reject count — see §19 for why the *end-of-phase* completeness numbers differ, which is itself a finding, not noise).

---

## 6. Track A watermark

| Platform | Source max `id` | Watermark | Matches |
|---|---|---|---|
| Flipkart | 50,007 | 50,007 | **true** |
| Myntra | 50,002 | 50,002 | **true** |

Confirmed by direct query, not assumed. **PASS.**

---

## 7. Track A idempotency

Re-ran immediately with no source changes:

| Platform | Rows read (run 2) | Rows inserted (run 2) | Rows rejected (run 2) |
|---|---|---|---|
| Flipkart | 0 | 0 | 0 |
| Myntra | 0 | 0 | 0 |

**PASS** — zero new work, watermark unchanged, confirmed at full 50k+ scale (not just the small unit-test fixture).

---

## 8. Track B reconciliation

Window formula verified directly from the actual query construction: `windowStart = today − (RECONCILE_LOOKBACK_DAYS + RECONCILE_SAFETY_BUFFER_DAYS) = today − 70 days`, filtering `WHERE review_date >= windowStart` — never `updatedAt`/`createdAt`/`ingested_at`. Confirmed both in source code (`trackB.ts`) and by the actual returned `windowStart: '2026-06-03'` (70 days before the run date).

| Platform | Rows scanned | Inserted | Unchanged | Updated | Rejected | Identity anomalies |
|---|---|---|---|---|---|---|
| Flipkart | 20,016 | 0 | 20,014 | 0 | 2 | 0 |
| Myntra | 20,079 | 0 | 20,079 | 0 | 0 | 0 |

(2 Flipkart rejects here = the two malformed control rows whose `review_date` falls inside the 70-day window — `CTRL-MALFORMED-RATING` and `CTRL-MALFORMED-PID`; the third, `CTRL-MALFORMED-DATE`, is from 2005 and correctly falls *outside* the window, so Track B never sees it again — only Track A caught it once.)

**PASS** — window is `review_date`-based as required, not time-of-ingestion-based.

---

## 9. Track B idempotency (no-change re-run)

| Platform | Inserted | Unchanged | Updated | Rejected |
|---|---|---|---|---|
| Flipkart | 0 | 20,014 | 0 | 2 |
| Myntra | 0 | 20,079 | 0 | 0 |

Identical to run 1 in every field that should be stable. **PASS for the core mechanism** — but see the important caveat in §19: the "2 rejected" here is not zero, and re-runs of Track B do not deduplicate reject bookkeeping (a real finding, not a re-run failure of the reconciliation logic itself).

---

## 9b. Reject bookkeeping — FINDING (not requested as its own numbered section, but required by "no unexplained difference is acceptable")

Every Track B pass that re-scans a still-malformed row inside its window creates a **new** `ingestion_rejects` row — there is no check for "already known bad, don't re-log." Across the 5 Track B invocations run in this phase (§8, §9, §10, §11, §12), the two in-window malformed Flipkart rows accumulated to **11 total reject rows** by the end (started at 3 from Track A). This is why §19's completeness audit shows a **negative** "MISSING" count (`-8`) — REJECTED (11) + MATCHED (50,004) exceeds source total (50,007), because the same 2 bad rows were counted multiple times.

**FAIL / KNOWN LIMITATION** — real, reproducible, confirmed on two independent full runs of this validation. In production, any row that's persistently invalid within the 70-day reconciliation window would accumulate a fresh `ingestion_rejects` entry on every daily reconciliation run for up to 70 days — unbounded growth for the same underlying bad row, and it makes naive `MATCHED + REJECTED == source` completeness checks unreliable without also deduplicating by `(platform, source_row_id)`. This is a design gap in Track B, not a test artifact — flagging for a decision, not fixing here (out of Phase 2 scope).

---

## 10. updatedAt-only test — the critical test

| | Before | After |
|---|---|---|
| content_hash | `c73e0738...525131c` | `c73e0738...525131c` (**identical**) |

`updatedAt` was bumped to `now()` with zero content fields touched; Track B run afterward shows `rowsUpdated: 0`, `rowsUnchanged: 20014` (the control row counted among the unchanged). **PASS** — this is the single most important behavioral guarantee in the whole system, and it held at full scale against real Track B execution, not a mock.

---

## 11. Content-change test

| | Before | After |
|---|---|---|
| content_hash | `97c34eab...ff27b` | `d4127ee9...ea9ba` (**different**) |
| reviewText | (original) | `"Completely rewritten review text for the content-change test — <timestamp>"` |

Track B: `rowsUpdated: 1`. **PASS** — meaningful content change correctly detected and the normalized row updated.

---

## 12. Rating-change test

| | Before | After |
|---|---|---|
| rating | 2 | 1 |
| content_hash | `0770a492...d9e77` | `46bc875f...b12f70e` (**different**) |

Track B: `rowsUpdated: 1`. **PASS.**

**Final local fixture state (documented, not restored):** `CTRL-RATING-1` in `DataWarehouse.myntra_reviews` now has `rating=1` — this is a controlled test row, not baseline data, left in its final mutated state rather than restored, per the instruction's "or clearly document the final local fixture state" option.

---

## 13. New-review test

Inserted `CTRL-NEWROW-1` into `DataWarehouse.flipkart_reviews` *after* the first Track A run had already completed and the watermark had advanced past it.

- Run 1 after insert: exactly 1 new normalized row for this control review.
- Run 2 (immediately after, no further changes): 0 additional rows.
- Final `normalized_reviews` count for this canonical review: **exactly 1**.

**PASS** — new-row detection and idempotency both hold on a genuinely new row inserted mid-session.

---

## 14. Duplicate test

`CTRL-UPDATEDAT-1` was processed by Track A once and Track B five times across this validation session (once per §8/§9/§10/§11/§12 run). Canonical row count for it: **1**. **PASS** — no duplicate canonical rows regardless of how many times a row is touched by either track.

---

## 15. Cross-platform identity test

Flipkart `pid='777777'` and Myntra `product_id=777777`, both with `review_id='XPLAT-SHARED-1'` — identical `(sourceProductId, sourceReviewId)` tuple after mapping.

| | canonical_review_id |
|---|---|
| Flipkart | `9d8bcbef96d529ba7d58949c53c92564` |
| Myntra | `9bf5ad29e6a285851e9cae3a960e7a08` |

Different, as required — `platform` is structurally part of the canonical identity hash. **PASS.**

---

## 16. Rollback test

Not re-derived from scratch — reused the real, already-passing `tests/integration/crashRecovery.test.ts`, which exercises the actual `appSequelize.transaction` + `advanceLastSeenSourceId` + `NormalizedReview` code (not mocks), re-confirmed passing in this session's full regression run (§28):

- **"watermark does NOT advance if the write transaction fails"** — forces a mid-transaction throw; watermark unchanged after. PASS.
- **"a batch insert failure never leaves a partially-advanced watermark"** — forces a real DB-level NOT NULL violation partway through a transaction that already issued the watermark update; watermark unchanged after rollback. PASS.

**PASS** — real transaction rollback semantics, proven against a real local Postgres instance, not simulated with mocks.

---

## 17. Crash/restart test

Two lines of evidence:

1. **Unit-scale, explicit crash simulation** (`crashRecovery.test.ts`, "process dies before returning" scenario): run Track A to completion, then re-invoke exactly as a restarted process would — second run reads 0 new rows, final counts match the first run's insert count exactly. PASS.
2. **Full-scale, real evidence from this session**: §7 above *is* a live crash/restart-equivalent proof at 50,000+ rows — Track A re-invoked after a completed run reads 0 rows and inserts 0 duplicates.

**PASS.**

---

## 18. Concurrency test — FINDING, not a clean PASS

Built a genuine two-worker race (`tests/integration/concurrency.test.ts`): both workers call `acquireLock → runTrackA → releaseLock` and are launched via `Promise.allSettled` so they race for real, not sequentially.

**What was found:** `acquireLock`'s `SERIALIZABLE` transaction does **not reliably serialize** two truly-simultaneous callers. Confirmed via direct reproduction:
- In one run, both workers successfully acquired the lock and ran Track A concurrently (0 blocked) — the intended mutual exclusion did not hold.
- In an isolated diagnostic re-run, the loser sometimes received a raw `SequelizeDatabaseError` (Postgres serialization-failure, code `40001`) instead of the intended `LockHeldError` — and `runIngestion.ts`'s catch block only special-cases `instanceof LockHeldError`, so this would crash the process rather than log a clean "skipped, lock held" message.
- The race is most exposed when the platform's `ingestion_watermarks` row doesn't exist yet: `getOrCreateWatermark`'s `findOrCreate` runs *outside* the locking transaction, so both callers can pass through it before either takes the row lock.

The permanent test (kept in the suite) does **not** assert clean mutual exclusion, since that's disproven — it asserts the one invariant that held across every observed run: no deadlock, and no duplicate/corrupted canonical rows even when both workers ran (Track A's own `ignoreDuplicates` upsert is a second, independent safety net at the data layer that appears to prevent data corruption even when the lock itself fails to exclude).

**FAIL / KNOWN LIMITATION** — the design intends full serialization per platform (single job lock, Phase 1 plan §4) but does not reliably achieve it under real concurrent pressure, and the failure mode isn't always the clean, handled one. Flagging for a decision — not fixed here, per Phase 2's validation-only scope. Given the real crawlers run once daily via presumably a single scheduler invocation, the practical exposure may be low, but "may be low" is not the same as tested-safe, and this should not be asserted as safe without a decision from you.

---

## 19. Data completeness audit (end of session — see §9b for why this differs from §5)

| Platform | MATCHED | REJECTED | ANOMALY | Source | Explained | MISSING |
|---|---|---|---|---|---|---|
| Flipkart | 50,004 | 11 | 0 | 50,007 | 50,015 | **-8** |
| Myntra | 50,002 | 0 | 0 | 50,002 | 50,002 | 0 |

Flipkart's negative "MISSING" is **fully explained**, not unexplained: it's caused entirely by §9b's reject-duplication finding (11 reject rows exist for only 3 distinct malformed source rows, because Track B re-logs a reject on every pass). Every *distinct* source row is still accounted for — 50,004 normalized + 3 distinct-malformed = 50,007 — the audit's arithmetic just isn't reject-row-deduplicated. Myntra, having no persistently-invalid rows, shows a clean 0.

**REQUIRES VERIFICATION** on the completeness *methodology* (needs reject-deduplication to be trustworthy long-term); **PASS** on the underlying data (no review was silently lost).

---

## 20. 30-day business window test

| Platform | Total normalized | Last 30 days (by `review_date`) |
|---|---|---|
| Flipkart | 50,004 | 10,115 |
| Myntra | 50,002 | 10,124 |

Consistent with Phase 1.5's seeded ~20% 0–30-day bucket weight at this scale. Directly proven never to use `updatedAt`: `CTRL-RATING-1` has `review_date='2026-08-07'` (5 days old, i.e. genuinely inside the 30-day window by date) but was deliberately excluded from this specific check as the "old review + recent updatedAt" example — its `source_updated_at` was bumped to *today* by the rating-change test, and the query still correctly filters by `review_date`, not `source_updated_at`. **PASS.**

*(Note: `CTRL-RATING-1`'s `review_date` is 5 days old, not outside 30 days — the important assertion is that the query construction never references `updatedAt` in its `WHERE` clause, which was confirmed directly in the SQL, not inferred from this one row's placement.)*

---

## 21. 1-year historical window test

| Bucket | Rows |
|---|---|
| 0–30 days | 20,239 |
| 31–60 days | 14,917 |
| 61–90 days | 14,940 |
| 3–6 months | 25,135 |
| 6–12 months | 24,775 |

All 5 buckets populated, matching the seeded distribution shape from Phase 1.5 (scaled to the combined 100k dataset). No bucket collapsed to zero, none dominates artificially. Windows are computed from `review_date` throughout (confirmed via the same query construction as §20). **PASS.**

---

## 22. Performance

| Run | Rows | Duration | Rows/sec |
|---|---|---|---|
| Flipkart Track A (initial) | 50,007 | 12.66s | 3,951 |
| Myntra Track A (initial) | 50,002 | 13.15s | 3,801 |
| Flipkart Track B (initial) | 20,016 scanned | ~4–5s (from batch log timestamps) | ~4,000–5,000 |
| Myntra Track B (initial) | 20,079 scanned | ~4–5s | ~4,000–5,000 |
| Full validation session (3× Track A + 5× Track B + all queries) | — | 107.36s wall (`/usr/bin/time`) | — |

Track A is meaningfully slower per-row than the earlier 12,000+ rows/sec seed-insert rate (§Phase 1.5) — expected, since Track A does per-row validation, hashing, and a real bulk upsert with conflict handling, not a raw batch INSERT. **PASS as "measured, not optimized"** — per instruction, no premature optimization was attempted. At ~3,800–4,000 rows/sec, a production-scale batch (tens of thousands to low millions of rows) would take single-digit minutes to low tens of minutes for a full Track A pass — worth knowing before a real production run, not treated as a blocker here.

---

## 23. Memory behavior

- Sampled during Flipkart Track A (100ms interval): peak **478MB RSS / 304MB heap**.
- Whole-process peak for the entire validation session (`/usr/bin/time -l`, macOS): **290MB maximum resident set size**, 43.6MB peak memory footprint.
- Confirmed via source review: `trackA.ts`'s loop calls `prodReadOnly.getFlipkartReviewsPage(afterId, batchSize)` per iteration and only holds one batch (≤5,000 rows) in memory at a time — never all 50,000+ rows at once. Batch size is `config.ingestion.batchSize` (5,000, from `INGEST_BATCH_SIZE`).

**PASS** — batch processing confirmed both by code review and by memory measurement; no evidence of unbounded memory growth across the full run.

---

## 24. Error handling

The 3 malformed control rows (§2) were processed correctly:

| review_id | Reason | Failed fields (allowlisted only) |
|---|---|---|
| `CTRL-MALFORMED-RATING` | `invalid_rating` | `{rating: 0, platform: 'flipkart'}` |
| `CTRL-MALFORMED-PID` | `missing_product_id` | `{platform: 'flipkart', sourceProductId: ''}` |
| `CTRL-MALFORMED-DATE` | `invalid_date` | `{platform: 'flipkart', rawDateString: '2005-01-01'}` |

- Ingestion did not crash — the other 50,004 valid Flipkart rows processed normally in the same run.
- Each rejection is structured, with a typed reason and an allowlisted `failedFields` object — never full review text or author.
- Watermark still advanced correctly past the malformed rows' `id`s (they're not retried by Track A on subsequent runs — confirmed by §7 showing 0 rejects on the idempotency re-run).

**PASS** for Track A. **KNOWN LIMITATION** for Track B's repeated re-rejection of the same rows on every window pass — see §9b.

---

## 25. Observability

Reviewed actual log output from this session's real ingestion runs against the requested field list:

| Requested field | Present? |
|---|---|
| platform | Yes |
| processed/inserted/updated/rejected counts | Yes (in the final result object per track) |
| source range | Partial — `afterId` per batch, but no explicit "from–to" range in one field |
| batch identifier | Partial — a numeric ordinal (`batch: 1, 2, ...`), not a stable `batchId` |
| job ID | **No** — no correlation ID ties a batch's log lines to a specific ingestion run |
| duration | **No** — not logged by the pipeline itself (only measured externally in this report) |
| anomaly count | Yes, in Track B's result object |
| final status | Implicit only (absence of an error) — no explicit `status: "success"` field logged |
| No review text / author / credentials | **Confirmed** — `logger.ts`'s `FORBIDDEN_LOG_KEYS` guard runtime-enforces this (throws in dev, strips+warns in prod), verified by `tests/security/piiLogging.test.ts` (4 passing tests) |

**KNOWN LIMITATION** — PII/secret exclusion is solid (structurally enforced, not just convention), but `jobId`, explicit `duration`, and an explicit final `status` field are genuinely missing from the current logging, not just under-tested. Flagging for a decision rather than adding fields unrequested in this validation-only phase.

---

## 26. Regression tests

```
Test Files  20 passed (20)
     Tests  99 passed (99)
```
(97 from Phase 1 + 1 new concurrency-characterization test file with 2 tests, replacing nothing — net +2 tests, +1 file.)

- `npm run typecheck` — clean, zero errors.
- `npm run safety-check` — `OK — no write-shaped SQL found in database/prodReadOnly/.`
- Coverage: 81.55% statements / 83.23% branches / 86.53% functions / 81.55% lines (materially unchanged from Phase 1's 81.73% — the small shift is denominator noise from the new test file, not a coverage regression).

**PASS.**

---

## 27. Known limitations

1. Track B re-logs a fresh `ingestion_rejects` row on every window pass for a persistently-invalid row — no deduplication (§9b, §24).
2. `acquireLock` does not reliably serialize truly-concurrent callers, and the loser's error isn't always the handled `LockHeldError` (§18).
3. Logging lacks `jobId`, explicit `duration`, and an explicit final `status` field (§25).
4. Performance was measured only at 100k-row scale on a single local machine — not representative of eventual production data volume or hardware (§22).

## 28. Unresolved issues

- Whether items 1–3 above need fixing before a real production ingestion run is a decision for you, not something resolved in this validation-only phase.
- The actual production role's grants (`review_intel_ro`) remain unverified from this environment — unchanged from the Phase 1.5 status, still blocked on credentials.

## 29. Final GO / NO-GO

**Can this system safely take the 100,000 local source reviews and produce a correct, idempotent, recoverable normalized dataset?**

**Mostly yes, with two specific caveats, not a clean yes.**

Evidence for yes: every core correctness property was proven at full 100k-row scale against the real code — completeness (once reject-duplication is accounted for), watermark correctness, Track A/B idempotency, `updatedAt`-blindness (the single most important guarantee), content/rating change detection, duplicate prevention, cross-platform identity separation, transactional rollback safety, crash/restart safety, batch-bounded memory, and structural malformed-row handling all held up under real execution, not mocks or assumptions.

Evidence against an unqualified yes: the concurrency guarantee does not reliably hold under real simultaneous execution (§18), and Track B's reject bookkeeping grows unbounded for persistently-bad rows (§9b). Neither corrupted the *normalized* dataset in any observed run — but "not yet observed to corrupt data" is not the same as "proven safe," and you explicitly asked not to convert an untested assumption into a PASS.

**GO for continued local development and further validation. NO-GO for unattended production concurrent scheduling until §18 is addressed or explicitly accepted as low-risk given the real crawlers' single-daily-run pattern.**

---

## Confirmations

```
PRODUCTION DATABASE ACCESSED: NO
PRODUCTION TABLES MODIFIED:   NONE
PRODUCTION TABLES CREATED:    NONE
PRODUCTION DATA MODIFIED:     NONE
```

Every connection in this phase used either `config.appStore` (local `postgres` superuser) or `config.prodReadOnly` pointed at `localhost` via shell-level environment variables through a dedicated local `SELECT`-only role (`local_dw_reader`) — never `.env`, never `DB_PROD_HOST` pointed anywhere but `localhost`.

**Stopping here. Not starting Phase 3, analytics, API, frontend, or AI work — waiting for your explicit approval.**
