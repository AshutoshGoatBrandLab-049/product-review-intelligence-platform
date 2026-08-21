# Automatic Source-Table Change Detection — Inspection & Design

**Status:** inspection complete, design proposed, **nothing implemented**
**Date:** 2026-08-21
**Scope:** `DataWarehouse.myntra_reviews`, `DataWarehouse.flipkart_reviews` → canonical → WebSocket → UI

Every measurement below was taken against the running system. Nothing is inferred
from comments, which are stale in several places.

---

## 1. Current architecture

### 1.1 Database topology

One PostgreSQL 18.4 database, one connection. `gbl_data_lake."DataWarehouse"` holds
**both** the source tables and every canonical/derived table:

| Table | Role |
|---|---|
| `flipkart_reviews`, `myntra_reviews` | SOURCE (only two that exist) |
| `normalized_reviews` | canonical |
| `product_dimension`, `product_daily_metrics` | derived analytics |
| `ingestion_watermarks` | ingestion cursor |

All reached through `appSequelize` (`config.appStore`). `DB_PROD_*` is validated
then discarded; the separate read-only pool was removed as dead code.

### 1.2 Ingestion entry points

`runIngestion(platform)` = `acquireLock` → `runTrackA` → `runTrackB` → `releaseLock`.

| Entry point | Emits WebSocket events to browsers? |
|---|---|
| `npm run ingest:flipkart` / `ingest:myntra` (CLI) | **No** — separate process, its emitter has no attached clients |
| `POST /internal/ingestion/trigger` (admin-only) | **Yes** — runs in the API process that owns the WS server |
| Automatic trigger | **Does not exist** |

This is the crux: any detector must run **inside the API process**, or events never
reach a browser.

### 1.3 Track A — new-row discovery

Keyset scan `WHERE id > watermark ORDER BY id`, keyed on the **primary key, not
`review_date`**. Per run:

1. Unconditional replacement check (`getReplacementSignals`)
2. Watermark-ahead guard — if `watermark > source MAX(id)`, full-scan once and rebuild
3. Batch loop: map → validate → filter to genuinely-new rows → insert → synchronize → advance watermark, all in one transaction per batch
4. `reconcileDeletions` — bounded `LIMIT 1` probe; if stale rows exist, delete + resync affected products
5. Events emitted **after** each commit

### 1.4 Track B — reconciliation

Full id-cursor scan (`RECONCILE_FULL_SCAN=true` default), batched content-hash
comparison, per-row transaction for each actual change. Emits post-commit.

### 1.5 WebSocket

`ws` server on :8080, singleton `webSocketEventEmitter`, module-level `onBroadcast`
fan-out to connected clients. Only event type: `PRODUCT_DATA_UPDATED`
`{ platform, sourceProductId, changedAt, changes }`.

### 1.6 Frontend

| Surface | Behaviour on `PRODUCT_DATA_UPDATED` | Assessment |
|---|---|---|
| `ProductRankingList` | Drops all `ranking-{platform}-*` cache keys, refetches current view in place | Good — platform-scoped, preserves filters/sort/page |
| `ProductDetail` | `queryClient.invalidateQueries` for productDetail/signals/insights, gated on exact `platform + sourceProductId` | Good — narrow, React Query handles refetch |
| `AIProductAnalyst` | Does not subscribe | Good — conversation cannot be interrupted |

`websocketClient` reconnects with exponential backoff (1 s → 30 s cap).

---

## 2. Current limitations

| # | Limitation | Evidence |
|---|---|---|
| L1 | **Nothing triggers ingestion.** No cron, no worker, no `setInterval`, no DB trigger, no LISTEN/NOTIFY. | grep of `backend/src`; 10 rows inserted live, browser watched 15 s → UI unchanged, canonical 0 |
| L2 | CLI ingestion cannot reach browsers | events go to an emitter with no clients |
| L3 | Frontend gives up permanently after **10** reconnect attempts | `maxReconnectAttempts = 10` |
| L4 | Frontend opens **two** WS connections → every event delivered twice | observed `sockets=3` (1 Vite HMR + 2 app) |
| L5 | No client-side dedupe by `message.id` | no `seen` set in `websocketClient` |
| L6 | `server.ts:29` logs "WebSocket server initialized" a second time after `initialize()` already did | cosmetic |

---

## 3. Constraints that rule options out

**C1 — This project does not own the source tables.** They are written by sibling
crawler repos. Adding triggers is DDL on another team's tables.

**C2 — `wal_level = replica`.** Logical replication requires `wal_level = logical`,
which needs a **PostgreSQL restart** plus a replication slot — a shared-infrastructure
change, and an unconsumed slot can pin WAL and fill the disk.

**C3 — `updatedAt` is unreliable for UPDATE detection.** No index, and **no trigger**
maintaining it. The exact statement in the requirements —
`UPDATE myntra_reviews SET rating = 1 WHERE review_id = '…'` — leaves `updatedAt`
untouched, so any probe based on it **misses the change entirely**.

---

## 4. Evaluating the detection options

| | A. LISTEN/NOTIFY | B. Trigger→outbox+NOTIFY | C. `pg_stat` probe + reconcile | D. Logical replication |
|---|---|---|---|---|
| DDL on source tables | yes ❌ (C1) | yes ❌ (C1) | **none** ✅ | none ✅ |
| Infra change / PG restart | no | no | **no** ✅ | yes ❌ (C2) |
| Detects bare UPDATE | yes | yes | **yes** ✅ | yes |
| Durable across restart | ❌ not a queue | ✅ outbox | ✅ via reconcile | ✅ slot |
| Missed-event recovery | needs fallback | outbox replay | **reconcile is the fallback** | slot replay |
| Detection latency | ~instant | ~instant | poll interval | ~instant |
| Cost when idle | ~0 | ~0 | **0.67 ms / poll** | ~0 |
| Risk if consumer dies | events lost | outbox grows | none | **WAL pins disk** ⚠️ |

### Measured basis for option C

`pg_stat_all_tables` counters, verified on a real table:

| Operation | Counter movement | Detected |
|---|---|---|
| `UPDATE … SET rating = rating` (no `updatedAt`, no trigger) | `n_tup_upd` 28 → 29 | ✅ |
| `INSERT` | `n_tup_ins` +1 | ✅ |
| `DELETE` | `n_tup_del` +1 | ✅ |

Cost: **0.67 ms**, no table scan, **O(1) in table size**. Compare a metadata probe
(`COUNT(*) + MAX(id) + MAX("updatedAt")`): **8 ms**, sequential scan, grows linearly,
**and misses bare UPDATEs**.

### Recommendation — **C**, with B as a later latency upgrade

Option C is the only one that needs neither DDL on tables we do not own (C1) nor a
database restart (C2), while still catching every operation class. Its weakness —
polling latency — is a tuning knob; the weaknesses of A and D are structural.

Crucially, **detection is only a hint. Correctness comes from reconciliation**, which
already exists and is already proven. `pg_stat` counters are approximate, can lag, and
reset on `pg_stat_reset()` or crash recovery — so the design never trusts them as truth:
a counter that moves *backwards or resets* is treated as "unknown" and forces a reconcile,
and a periodic sweep runs regardless of what the counters say.

---

## 5. Proposed design

### 5.1 Component

A `SourceChangeDetector` started from `server.ts` — **in the API process**, so emitted
events reach connected browsers (L2).

```
every POLL_INTERVAL (default 5s), per platform:
  read pg_stat counters                       ~0.67ms
  if (counters moved) OR (counters reset) OR (SWEEP_INTERVAL elapsed):
      runIngestion(platform)                  ← existing, unchanged
      on success: persist observed counters
      on failure: do NOT persist  → retried next tick
```

`runIngestion` is reused untouched, so INSERT / UPDATE / DELETE / REPLACEMENT are all
handled by logic already proven by 19 matrix tests.

### 5.2 Why this satisfies the historical-data requirement

Two independent guarantees already in place, neither dependent on the detector:

- **Old-review UPDATE** — Track B full scan (`RECONCILE_FULL_SCAN=true`) compares content
  hashes across the whole table, no date window. Verified: a 200-day-old review edited
  5 → 1 now propagates (`source=1, canonical=1`).
- **Backfill below the watermark** — the watermark-ahead guard full-scans once and rebuilds
  the cursor. Verified: a row at id 1,173 under a watermark of 52,467 is now ingested.

The periodic sweep is the third net: even if the detector never fires, state converges.

### 5.3 Transaction boundaries (unchanged)

```
BEGIN → writes → synchronize → validate → COMMIT → emit events
```
Rollback ⇒ **no** events. WebSocket failure ⇒ DB stays committed (broadcast is
try/caught per product). Already enforced and tested.

### 5.4 Failure and recovery

| Failure | Behaviour |
|---|---|
| Ingestion throws | counters **not** persisted → retried next tick; advisory lock released in `finally` |
| DB connection lost | poll throws, logged, retried with backoff; counters unchanged |
| PostgreSQL restart | counters reset → detected as "unknown" → forced reconcile |
| Backend restart | detector re-reads counters; first tick reconciles |
| Another instance mid-run | `pg_try_advisory_lock` returns false → `LockHeldError` → skipped, retried |
| WebSocket down | DB still converges; browser catches up on reconnect **(requires fixing L3)** |

### 5.5 Performance

| Scenario | Expected |
|---|---|
| Idle | 0.67 ms per platform per tick |
| 1 row inserted | one Track A batch, 1 product event |
| 100 rows | one batch, ≤100 deduped product events |
| 10,000 rows | 2 batches (`INGEST_BATCH_SIZE=5000`) |
| Bulk delete | `reconcileDeletions` — one bounded probe, then one cleanup transaction |
| Full replacement | retention → 0 → atomic full resync (measured **11 s** for 21,647 rows live) |

Events are already deduplicated per `platform + sourceProductId` per batch.

### 5.6 Security

Detector is internal — no new endpoint, no new surface. `/internal/ingestion/trigger`
stays `authenticate + adminOnly`; `/internal/ingestion/health` stays open.

---

## 6. Work required

| # | Change | Risk |
|---|---|---|
| 1 | `SourceChangeDetector` + wire into `server.ts` (start/stop) | new code, isolated |
| 2 | Config: `AUTO_SYNC_ENABLED`, `AUTO_SYNC_POLL_MS`, `AUTO_SYNC_SWEEP_MS` | low |
| 3 | **L3** — remove the permanent give-up after 10 reconnect attempts | small, required by Test 14 |
| 4 | **L4** — single WS connection per page | small |
| 5 | **L5** — dedupe by `message.id` client-side | small |
| 6 | Tests 1–15 + timestamped E2E proof | largest effort |

---

## 7. Open questions — need your decision

1. **Poll interval.** 5 s means ≤5 s latency at 0.67 ms/tick (~0.013 % duty cycle).
   Faster is affordable; is ≤5 s acceptable?
2. **Sweep interval.** Safety-net full reconcile — 5 min? 15 min? Cost is one Track B
   full scan (a few seconds at current volume).
3. **Enabled by default?** I propose `AUTO_SYNC_ENABLED=true` in dev, explicit in prod.
4. **Trigger + outbox later?** If the crawler team will add a trigger, option B drops
   latency to ~instant while keeping option C as the safety net. Worth pursuing?
5. **`pg_stat_reset()`** by an operator forces one extra reconcile. Acceptable?

---

## 8. Honest scope note

This design deliberately reuses `runIngestion` rather than building a second
synchronization path. The correctness work is already done and proven; what is missing
is purely **the thing that starts it**. Any design that reimplements synchronization
would put the guarantees at risk for no gain.

**Nothing has been implemented. Awaiting approval.**
