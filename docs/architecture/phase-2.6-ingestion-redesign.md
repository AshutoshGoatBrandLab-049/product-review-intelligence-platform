# Product Review Intelligence Platform — Ingestion Redesign

> **Superseded 2026-08-11 by [Phase 2.8](phase-2.8-final-ingestion-architecture.md).** The index question raised here was refined in [Phase 2.7](phase-2.7-reconciliation-index-analysis.md) and finalized against verified live indexes in Phase 2.8 — read that document for the current design. Kept here as historical record of how the design evolved.

**Phase 2.6 · Ingestion Correction · Not for Implementation**

A new operational fact — both crawlers re-scrape and unconditionally re-upsert the trailing lookback window every run — invalidates the `updatedAt`-based watermark this platform's design has relied on since Phase 2. Here's what the code actually does, and the corrected design.

- 2026-08-11
- Production DB: not modified
- No tables created
- Corrects: Phase 2 §8/§9, Phase 2.5 findings

---

## 00. What Changed

Both crawlers run repeatedly against a rolling lookback window (`CRAWL_LOOKBACK_DAYS`, documented as `60` in both `.env.example` files, default `90` in code if unset — **verified from code**, `config/index.js:46` Flipkart / `:54` Myntra). On every run, every review that falls inside that window gets re-scraped and passed through `bulkUpsert` — **unconditionally, with no comparison against what's already stored**. Confirmed directly at the call sites: `CrawlerEngine.js:141` (Flipkart) and `CrawlerEngine.js:111` (Myntra) both pass every date-filtered review straight to `bulkUpsert` with zero pre-check for whether anything actually changed since last time.

Since `updatedAt` is in both crawlers' `updateOnDuplicate` column list, and Postgres's `ON CONFLICT ... DO UPDATE SET` executes unconditionally on every conflict (no value-equality guard exists anywhere in this code), **`updatedAt` gets bumped for every review in the lookback window on every single crawl run** — whether the review's actual content changed or not. The entire Phase 2/Phase 2.5 incremental design assumed `updatedAt > watermark` meant "new or genuinely changed." It doesn't. It means "was re-crawled," which — for any review less than ~60 days old — is true almost every day regardless of content.

---

## 01. The Six Questions, From Code

**1. When is a new review inserted?**
When a scraped review's natural key — `(pid, review_id)` for Flipkart, `(product_id, review_id)` for Myntra — doesn't already exist in the table. `bulkCreate` with `ON CONFLICT` resolves to a plain `INSERT` for that row. **Verified from code.**

**2. Are existing reviews updated on every crawl?**
**Yes — every review inside the lookback window, every run, regardless of whether anything changed.** There is no diff/comparison step anywhere before `bulkUpsert` is called; every date-filtered scraped review goes through the same upsert path whether it's brand new or was already in the table unchanged. **Verified from code**, `CrawlerEngine.js` both platforms.

**3. Does createdAt change?**
**No.** `createdAt` is absent from both crawlers' `updateOnDuplicate` lists (Flipkart: `ReviewRepository.js:62`; Myntra: `:44-55`) — Sequelize sets it once, on the original `INSERT`, and it is never touched again by any subsequent conflict. It reliably represents "when this row first entered the production table." **Verified from code.**

**4. Does updatedAt change on every crawl, or only on actual changes?**
**On every crawl that re-touches the row** — not only on actual changes. It's in both `updateOnDuplicate` lists, and the `DO UPDATE SET` clause Sequelize generates has no `WHERE (row differs)` guard. Every re-scrape of an already-known review inside the lookback window bumps it, identical content or not. **Verified from code.**

**5. What happens when an existing review is rediscovered?**
It goes through the identical `bulkUpsert` path as a brand-new review. Its natural key already exists, so it resolves to an `UPDATE`: `rating`, `title`/`comment`/`body`, helpful counts, `brandName`, and `updatedAt` are all overwritten with whatever the current scrape produced — even if byte-identical to what was already stored. `createdAt` and `id` are untouched. **Verified from code.**

**6. Is review_id used for upsert/deduplication?**
Yes, as part of the composite conflict target — `conflictAttributes: ['pid','reviewId']` (Flipkart) / `['productId','reviewId']` (Myntra) — unchanged from what was already established in the prior two reviews. **Verified from code.**

---

## 02. Why updatedAt Fails as a Change-Detection Signal

Given a daily crawl against a 60-day window: any review posted within the last 60 days gets its `updatedAt` bumped roughly once a day, every day, until it ages out of the window — independent of whether its rating, text, or any other field ever actually changes. A watermark query like `WHERE updatedAt > last_watermark` would therefore return *nearly the entire active window* on every run, not a small delta — it never behaves like a genuine incremental filter for this data. This isn't a performance nuance; it's a category error in what the field represents, and no index on `updatedAt` would have fixed it — indexing a signal that doesn't mean what you need it to mean just makes you scan the wrong thing faster.

---

## 03. Redesigned Ingestion Strategy

```
┌─ NEW-ROW DETECTION ─────────────────────────────────────────┐
│  WHERE id > last_max_id_seen  ORDER BY id                    │
│  → id is the PK, already indexed, monotonic on insert         │
│  → untouched by re-crawls (an UPDATE never changes id)         │
│  → cheap regardless of table size — no new index needed        │
└─────────────────────────────────────────────────────────────┘

┌─ CHANGE / RECONCILIATION DETECTION (existing rows) ────────────┐
│  Candidate set: review_date >= today − (lookback + buffer)     │
│  → bounded to ~65-70 days of data, NOT the full historical table│
│  → older rows are frozen — the crawler never revisits them      │
│  For each candidate: recompute content_hash from freshly-read   │
│  source fields, compare to our stored hash, reprocess only on   │
│  mismatch — never trust updatedAt to mean "changed"              │
└─────────────────────────────────────────────────────────────┘
```

### New-row detection

Use `id` alone — not `createdAt`, not `updatedAt`. `id` is the primary key on both tables, already indexed, and monotonically increasing on insert (single-writer, sequential `bulkCreate` calls per crawl run — consistent with the "no evidence of concurrent workers" finding from the prior review). It's a strictly better cursor for this purpose than `createdAt` would be: `createdAt` is stable and trustworthy (§1 Q3) but is not indexed on either table, so a `createdAt`-based cursor would face the same unindexed-scan problem originally flagged for `updatedAt`. `id`-range scanning sidesteps that entirely — it needs no new index on either production table.

### Change/reconciliation detection

This is the part that actually needs redesigning. Since the crawler itself never revisits a review once it ages out of the lookback window, **this platform's own reconciliation workload is naturally bounded to the same window** — regardless of how large the total historical corpus grows. A review older than ~60-70 days is frozen by construction and needs to be ingested exactly once; only the trailing window needs periodic re-checking.

For that bounded candidate set, don't trust `updatedAt` — compute a `content_hash` over the fields that actually matter (rating, review text, helpful counts, brand) from what's freshly read, and compare it against the hash already stored for that `canonical_review_id`. Only mismatches trigger reprocessing (theme/sentiment re-classification, health-score inputs, etc.). This is strictly more correct than the `updatedAt`-based design and, as a side effect, resolves the "watermark late-commit / safety-lag" concern from the prior review — there's no longer a moving sub-day target to race against, since the crawler itself only refreshes once a day and the candidate set is small and fully re-checkable each time.

### Cadence

Match the reconciliation job to the crawler's own cadence — running it more often than the crawler updates data has no benefit, since the crawler is the only source of change. New-row detection via the `id` cursor can run as often as useful at effectively no cost, independent of the reconciliation job's schedule.

---

## 04. Revised Index Ask

This redesign changes what to actually request from a DBA — and it's a meaningfully smaller ask than before:

| Table | Was recommended (Phase 2.5) | Now needed |
|---|---|---|
| Flipkart `flipkart_reviews` | ~~index on updatedAt~~ | **Nothing** — already has `(review_date)` and `(pid, review_date)`, which is exactly what the bounded reconciliation query needs. |
| Myntra `myntra_reviews` | ~~index on updatedAt~~ | **One non-unique index on `review_date`** (or `(product_id, review_date)`) — mirroring what Flipkart already has. Myntra currently has no index supporting a date-bounded scan at all. |

Neither table needs an `updatedAt` index under this design — it's no longer part of the ingestion cursor strategy at all. This is a genuine walk-back from the prior review's "critical" finding, not a quiet swap: that finding correctly identified a real gap (the incremental design as originally specified truly wasn't production-safe), but the fix it proposed is no longer the right one now that the actual crawl semantics are known. The new ask — one small, precisely-targeted index on one table — is easier to justify and approve than the original two-table request.

---

## 05. What This Supersedes

| Prior document | What it said | Correction |
|---|---|---|
| Phase 2 §8/§9 | `WHERE updatedAt > last_watermark ORDER BY updatedAt, id` | Replaced by the two-track design in §03: `id`-cursor for new rows, bounded content-hash diff for reconciliation. |
| Phase 2.5 critical review, §4 | "Critical: neither table indexes `updatedAt`" — recommended indexing it on both | The underlying gap was real, but indexing `updatedAt` was never going to be the right fix, since the column doesn't mean what the design needed it to mean. Superseded by §04 above. |
| Final audit, Part 6 / gate items 7, 8, 11 | Ingestion/watermark strategy marked FAIL pending the index-approval decision; safety-lag buffer recommended | Safety-lag is no longer needed (§03 — cadence explanation). Gate items 7/8/11 should be re-evaluated against this design once it's written into the architecture doc rather than the original watermark plan. |

---

## 06. Not Implementing Yet

As instructed — this is analysis and design only. No files were modified, no database objects created, no code written. This redesign should be folded into a revised Phase 2 §8/§9 and the Phase 2.5 final audit's gate items before Phase 1 implementation begins, alongside the still-open decisions from both prior documents (index approval now scoped to Myntra's `review_date` only; `ai_insights.confidence` definition; health-score shrinkage; and the rest of Q1–Q14).

---

*Analysis only — no application code, database objects, or crawler code were created or modified. Six questions answered directly from source, two prior "critical" findings revised in light of new, verified information about how the crawlers actually run.*

*Source: [Ingestion redesign artifact](https://claude.ai/code/artifact/9211a48d-8a71-4f25-a133-2fa148268ecb)*
