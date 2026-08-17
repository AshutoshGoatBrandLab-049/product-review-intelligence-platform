# Product Review Intelligence Platform — Final Ingestion Architecture & Implementation Gate

**Phase 2.8 · Final Ingestion Design · Awaiting Approval**

The Myntra `review_date` index is live and verified. This consolidates everything from Phase 2.6 and 2.7 into one canonical ingestion design, redraws the affected diagrams, and produces an updated implementation gate — nothing further created, nothing implemented.

- 2026-08-11
- Production DB: index added, user-approved, no data touched
- No further DB objects created
- Consolidates: [Phase 2.6](phase-2.6-ingestion-redesign.md), [Phase 2.7](phase-2.7-reconciliation-index-analysis.md)

---

## Verdict

### READY AFTER REQUIRED CHANGES — ingestion track now resolved

The single item that carried "critical" severity across two prior reviews — the ingestion/watermark/index design — is now fully specified, fully index-supported on both platforms, and no longer blocking. Everything else unrelated to ingestion (health-score shrinkage, AI-confidence definition, theme taxonomy, security hardening, and the remaining Q1–Q14 decisions) is unchanged and still open. Full gate in the Implementation Gate section below.

---

## 01. Verified Database State

| Platform | Index | Status | Role in this design |
|---|---|---|---|
| Flipkart | `flipkart_reviews_review_date` | pre-existing | Supports the bounded reconciliation scan (§05). |
| Flipkart | `idx_flipkart_reviews_updatedat_id` | pre-existing, not in Sequelize model | Available as a candidacy-filter fallback (Phase 2.7) — not used as the primary design. |
| Myntra | `idx_myntra_reviews_updatedat_id` | pre-existing, not in Sequelize model | Same fallback role as Flipkart's equivalent. |
| Myntra | `idx_myntra_reviews_review_date` | **newly created, user-approved** | Supports the bounded reconciliation scan — closes the one gap identified in Phase 2.7. |

Both tables' primary keys (`flipkart_reviews.id`, `myntra_reviews.id`) remain indexed as before — unaffected, always sufficient for new-row detection. **No review data was modified** by this index addition; both source tables remain strictly read-only for this platform going forward, exactly as before.

With this change, both platforms are now symmetric: PK index (new-row detection) + `review_date` index (reconciliation) + `(updatedAt, id)` index (available fallback, unused by default). The ingestion design below is identical for both platforms — no platform-specific branching required at the query-strategy level.

---

## 02. The Ingestion Design, Formalized

1. **New source rows:** detected via source primary-key `id` keyset pagination — `WHERE id > last_seen_source_id ORDER BY id`. Always resolves to a normalization + `INSERT` path, since by definition the natural key doesn't exist yet in `normalized_reviews`.
2. **Recent reconciliation:** a bounded, `SELECT`-only read of the active `review_date` window (lookback + safety buffer), with content hashing to determine whether a previously-ingested review's normalized representation actually changed. No write of any kind ever touches the source tables.
3. **Business analysis:** uses `review_date` (Flipkart) / `review_date` (Myntra, derived from `reviewed_at`) exclusively for every analysis window — 30-day, 90-day, 6-month, 1-year. This was already the design in Phase 2 §5 and Phase 2.6; restated here for completeness since it sits right next to the ingestion cursors and shouldn't be confused with them.
4. **`updatedAt`:** retained as descriptive source metadata only (`normalized_reviews.source_updated_at`, per Phase 2 §3) — informative for observability and as the documented fallback candidacy filter (§01), but **never** treated as proof a review is new or that its content changed. That determination belongs exclusively to the `id`-cursor (new rows) and the content-hash comparison (changed rows).
5. **Existing source tables:** never receive `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP`, or any other modification from this application — unchanged from every prior document in this series, restated here as the design's non-negotiable boundary condition.

---

## 03. Data Flow, Redrawn

```
Production Raw Reviews         flipkart_reviews · myntra_reviews
                                  (id PK · review_date idx · (updatedAt,id) idx — both platforms)
                                              │  READ-ONLY · SELECT ONLY
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                    ▼
        ┌─ TRACK A: New Rows ──────────┐                 ┌─ TRACK B: Reconciliation ──────────┐
        │ WHERE id > last_seen_id       │                 │ WHERE review_date >= window_start   │
        │ ORDER BY id                   │                 │ ORDER BY id                          │
        │ (PK-indexed, cheap always)     │                 │ (review_date-indexed, both platforms)│
        │ → always a normalization+      │                 │ → content_hash(fresh) vs             │
        │   INSERT path                  │                 │   content_hash(stored); mismatch     │
        │                                 │                 │   only → reprocess                   │
        └────────────────┬───────────────┘                 └────────────────┬─────────────────────┘
                          └──────────────────────┬───────────────────────────┘
                                                  ▼
                                     Normalization + Validation  (Phase 2 §3, §6)
                                                  ▼
                                  normalized_reviews  (upsert by canonical_review_id)
                                                  ▼
                                  review_intelligence → metrics → health → trends → AI
                                                  (unchanged from Phase 2 §2 onward)
```

The two tracks read the same source tables but never overlap in write responsibility — Track A only ever inserts (new key), Track B only ever updates-if-changed (existing key). Should Track A occasionally miss a row that Track B's wider reconciliation window also covers, Track B's upsert-if-different logic absorbs it harmlessly — an intentional, low-cost redundancy, not a design flaw.

---

## 04. Checkpoint / Cursor Strategy

Replaces the single `last_source_updated_at` watermark field from Phase 2 §7 with a design matching the two-track model:

### `ingestion_watermarks` (revised)

- **PK:** `platform`
- **New-row cursor:** `last_seen_source_id` (bigint) — advanced only after its batch's normalize+insert commits; same transaction (resolves the atomicity note from Phase 2.5 §9).
- **Reconciliation state:** `last_reconciliation_run_at`, `last_reconciliation_rows_scanned`, `last_reconciliation_rows_changed` — observability, not a resumable cursor. Reconciliation re-scans the same bounded window each run by design; a crash mid-run just means the next run re-scans the same window, which is harmless given idempotent, hash-gated writes.
- **Job lock:** `status` (`idle`/`running`), `lock_acquired_at` with a stale-lock timeout — resolves the job-locking gap from Phase 2.5 §9. Both tracks run under the same per-platform lock, since both now run once daily and there's no benefit to decoupling their schedules.

No new database object is created by specifying this — it remains a design for a future migration, exactly like every other entity in this series.

---

## 05. Reconciliation Strategy

1. Compute the window: `[today − (CRAWL_LOOKBACK_DAYS + safety_buffer), today]` against `review_date`.
2. Read the window in `id`-ordered chunks (Phase 2.7's query, now fully index-supported on both platforms) — `SELECT ... WHERE review_date >= $window_start ORDER BY id`, read-only.
3. For each row read, compute `content_hash` over the fields that matter for downstream intelligence — rating, review text, helpful count(s), brand, and platform-specific fields (Phase 2 §3's unified model).
4. Look up the existing `normalized_reviews` row by `canonical_review_id` (a cheap, indexed point-read — the ID is deterministic, no scan required).
5. **No existing row:** normalize and insert — this is the harmless overlap with Track A noted in §03, not an error condition.
6. **Existing row, hash matches:** no-op. This will be the overwhelming majority of rows on any given day, since most re-crawled reviews genuinely haven't changed.
7. **Existing row, hash differs:** update `normalized_reviews`, bump `content_hash`, mark for `review_intelligence` reprocessing (Phase 2 §7's existing content-hash-triggered refresh mechanism — this section specifies precisely how that hash comparison is actually produced, which Phase 2 had left implicit).
8. A hash mismatch whose new values look like a wholesale identity swap rather than a minor edit (author, title, and rating all different at once) is exactly the symptom the `identity_anomalies` table exists to catch (Phase 2.5 §4D) — this reconciliation step is where that detection actually runs, not a separate mechanism.

---

## 06. Business Analysis Date Usage

Unchanged, restated for clarity given how close it sits to the ingestion cursors: every dashboard analysis window — latest 30 days, previous 30 days, 90 days, 6 months, 1 year — filters on `review_date` (the customer's actual review date), never on `updatedAt` or any ingestion-internal field. This was already true in Phase 2 §5 and Phase 2.6; nothing in this document changes it.

---

## 07. Updated Roadmap — Phase 0 / Phase 1

| Phase | What changed from the original roadmap |
|---|---|
| Phase 0 — Approvals & access | The index-approval item is **resolved** — completed and verified this session. Remaining Phase 0 items (read-only role provisioning, own-store location) are unaffected and still open. |
| Phase 1 — Read-only ingestion | Implementation work now has a fully-specified, fully-index-supported design to build against: the two-track cursor model (§02–§05), the revised `ingestion_watermarks` schema (§04), and job-locking. No remaining ambiguity in this phase's technical design — what's left is implementation and the still-open non-ingestion decisions (DB role, own-store location) that gate *starting* Phase 1, not its design. |

---

## 08. Final Architecture Implementation Gate

Supersedes the gate table in the Phase 2.5 final audit. Three items flip to PASS; everything else is unchanged since nothing else was touched this session.

| # | Gate | Status | Evidence | Required Action |
|---|---|---|---|---|
| 1 | Production DB read-only access | **USER APPROVAL REQUIRED** | Role design documented, not yet provisioned | Approve provisioning (Q1) |
| 2 | Own writable DB | **USER APPROVAL REQUIRED** | Design sound; location undecided | Answer Q2 |
| 3 | No production writes (structural guarantee) | **FAIL** | DB-role plan sound; code-level defense-in-depth not yet built (nothing to build against yet — pre-implementation) | Build the no-write-surface constraint into `prodReadOnly` when Phase 1 starts |
| 4 | Source schema verification | **PASS** | PKs, indexes (including live state, this session), upsert columns, hash generation, TZ settings all verified from code and live DB, repeatedly | None |
| 5 | Identity strategy | **FAIL** | Sound core design; missing fields, hash-framing correction, date-boundary-instability documentation still open — unrelated to ingestion | Prior audits' fixes |
| 6 | Date strategy | **FAIL** | Missing confidence-count propagation fields — unrelated to ingestion | Prior audit's fix |
| 7 | Ingestion strategy | **PASS — was FAIL** | Fully specified two-track design (§02–§03), matches verified crawler behavior exactly | None — ready for Phase 1 implementation |
| 8 | Watermark / checkpoint strategy | **PASS — was FAIL** | Revised `ingestion_watermarks` schema (§04) resolves job-locking and atomicity gaps | None |
| 9 | Idempotency | **PASS** | Unchanged — deterministic canonical ID + upsert, consistent with source behavior | None |
| 10 | Data model | **FAIL** | `ingestion_watermarks` now fully specified (§04); `theme_metrics_daily` sparsity and a few other fields still open elsewhere | Prior audit's fixes (remaining tables only) |
| 11 | Indexes | **PASS — was FAIL** | Both platforms now symmetric: PK + `review_date` + `(updatedAt,id)`, live-verified this session | None |
| 12 | Scalability | **FAIL** | Analyst retrieval scope still unspecified; `theme_metrics_daily` sparsity still needs to be written in — unrelated to ingestion | Prior audit's fixes |
| 13 | Health score | **FAIL** | Shrinkage still needed — unrelated to ingestion | Prior audit's fix |
| 14 | Confidence thresholds | **NOT VERIFIED** | Still needs real post-backfill data | Analyze after Phase 1 backfill |
| 15 | Theme taxonomy | **FAIL** | Hinglish, short-text gating, versioning migration still open — unrelated to ingestion | Prior audit's fixes |
| 16 | AI safety | **FAIL** | `ai_insights.confidence` ambiguity still open — unrelated to ingestion | Define `confidence` explicitly |
| 17 | Evidence validation | **PASS** | Unchanged — sound across all prior passes | None |
| 18 | API | **FAIL** | Missing index (on our own store), N+1 requirement, regen-status gap — unrelated to ingestion | Prior audit's fixes |
| 19 | Security | **FAIL** | Defense-in-depth, config-divergence check, canary monitoring, role model still need writing in — unrelated to ingestion | Prior audit's fixes |
| 20 | Observability | **FAIL** | PII-in-logs rule still missing; reconciliation job now has good observability fields built in (§04) which helps but doesn't close this gate alone | Add the PII rule |
| 21 | Testing | **FAIL** | Test list from prior audit still needs building; the two-track design gives cleaner, more specific test targets now | Build the test list, updated for §02–§05's design |
| 22 | Deployment | **NOT VERIFIED** | Hosting (Q8) and scheduler (Q5) still undecided | Answer Q5, Q8 |
| 23 | Documentation | **PASS** | Eight documents now published to `docs/architecture/`, including this one, tracking the full decision history including corrections | None |

---

## 09. Still Open

Everything not touched by this session's ingestion work remains exactly as the prior final audit left it: Q1–Q14 (Phase 1 §18 / Phase 2 §26), plus the health-score shrinkage design, the `ai_insights.confidence` definition, theme-taxonomy production-readiness gaps, and the security/observability/testing/API items in gate rows 3, 5, 6, 10, 12, 13, 15, 16, 18, 19, 20, 21. None of these are new — none require re-reading; they're unaffected by today's work and simply weren't in scope for it.

---

*Design and verification only — the one production change made today (the Myntra `review_date` index) was explicitly approved by the user beforehand, touched no data, and is now reflected accurately in this architecture. No further database objects, code, or crawler changes were made. Awaiting approval before any implementation phase begins.*

*Source: [Final ingestion architecture artifact](https://claude.ai/code/artifact/7719c1c0-92ee-458d-9d56-6daa878447f5)*
