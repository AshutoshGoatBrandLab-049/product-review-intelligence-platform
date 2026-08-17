# Product Review Intelligence Platform — Reconciliation Index Necessity Analysis

> **Outcome superseded 2026-08-11 by [Phase 2.8](phase-2.8-final-ingestion-architecture.md).** After this analysis concluded the index wasn't needed yet, the user independently decided to approve and create it anyway — Phase 2.8 reflects the actual verified live state. The reasoning below (why it wasn't *required*, and what it's for) is still accurate and worth reading; only the "don't request it yet" outcome no longer applies.

**Phase 2.7 · Pre-Approval Analysis · Not for Implementation**

Before asking for any production DDL change, a rigorous answer to whether one is actually needed — informed by a live index inventory this session didn't have access to before now.

- 2026-08-11
- Production DB: not modified
- No index created
- Follows: [Phase 2.6 ingestion redesign](phase-2.6-ingestion-redesign.md)

---

## Conclusion, Up Front

The Myntra `review_date` index proposed in Phase 2.6 is **not required at current or near-term scale**. A plain sequential scan bounded to a once-daily reconciliation job is genuinely cheap enough that requesting a production index isn't justified yet — full reasoning below, with an explicit, measurable trigger for revisiting it later rather than deferring indefinitely.

The six indexes the user found live on `myntra_reviews` are new information — the crawler's Sequelize model only *declares* `myntra_reviews_product_id_review_id` (unique) and `myntra_reviews_product_id`. Two things in the live list weren't in the model at all: `idx_myntra_reviews_updatedat_id` and a second, differently-named set (`myntra_crawler_review_pkey`, `myntra_crawler_review_product_id`, `myntra_crawler_review_product_id_review_id`) that look like they predate a table rename or migration. **NOT VERIFIED** how or when these were added — Sequelize's `sync({alter:false})` only ever creates what the model declares, so anything beyond that was added directly against the database, outside anything visible in either crawler repo. No guess is made here about who added them or why.

---

## The Ten Questions

**1. The exact reconciliation query.** Keyset-paginated, ordered by the indexed PK, filtered on the business date field:

```sql
SELECT id, product_id, review_id, brand_name, rating, title, body,
       review_date, reviewed_at, helpful_count, not_helpful_count,
       has_images, image_urls, size_purchased, color_purchased,
       "updatedAt"
FROM "DataWarehouse".myntra_reviews
WHERE review_date >= (CURRENT_DATE - INTERVAL '70 days')
  AND id > $last_id
ORDER BY id
LIMIT 5000;
```

(70 days = 60-day `CRAWL_LOOKBACK_DAYS` + a 10-day safety buffer, matching the margin already built into Phase 2.6's design.)

**2. Is `review_date` the correct field?** **Yes** — it's the one date field common to both platforms' schemas, it's `NOT NULL` on both, and it's literally the same dimension the crawler itself uses to decide what's in-window (the crawler's own cutoff/end filtering operates on parsed review dates before ever calling `bulkUpsert` — verified in `CrawlerEngine.js` on both platforms). Using it for our own candidate-window selection means our definition of "active window" matches the crawler's definition exactly, by construction.

**3. Expected candidate volume, 60–70 days.** **NOT VERIFIED** — no live row counts available in this session, and Phase 1 discovery already noted the corpus is still being collected, so there's no fixed total to divide by. Order-of-magnitude only: if the stated "1M+ reviews" target is roughly evenly spread across ~365 days across both platforms, that's on the order of a few thousand reviews/day combined, tens of thousands (not millions) over a 70-day window for Myntra alone. Real posting volume is almost certainly uneven (campaigns, seasonality, ramping data collection), so treat this as a rough floor-to-low-hundreds-of-thousands range, not a number to design tight tolerances around.

**4. Can the existing six indexes support this query?** **No** — none of them lead on `review_date`:

| Index | Covers | Usable for `WHERE review_date >= X`? |
|---|---|---|
| `myntra_crawler_review_pkey` | `id` (PK) | No — supports the keyset `ORDER BY id` tail of the query, not the date filter. |
| `idx_myntra_reviews_updatedat_id` | `(updatedAt, id)`, presumed | No, not directly — but see below, it has a legitimate secondary use here. |
| `myntra_crawler_review_product_id` / `myntra_reviews_product_id` | `(product_id)` | No — different column entirely. |
| `myntra_crawler_review_product_id_review_id` / `myntra_reviews_product_id_review_id` | `(product_id, review_id)`, unique | No — `review_date` isn't a member of either composite. |

Without a supporting index, the planner has no choice but a sequential scan of the full table to evaluate `review_date >= X`.

**5. Comparing (A) `(review_date)` vs (B) `(product_id, review_date)`.** The reconciliation query filters on `review_date` alone — it doesn't filter or group by `product_id` first. A leading `product_id` column in (B) would sit unused for this specific access pattern (index columns only help a range/equality scan when the query constrains them, in leading order). (A) matches the actual predicate; (B) would only earn its extra column if some other query also filtered by a specific `product_id` *and* a date range together — not this one.

**6. Which index matches the query pattern?** **(A) `(review_date)`** — plain, single-column, non-unique. (B) is unjustified overhead for this access pattern specifically.

**7. Is it necessary at current scale?** **No.** This is the crux, and the reasoning has to hold up on its own, not just defer to caution: the reconciliation job runs **once a day** (Phase 2.6 — matching crawl cadence, not the original every-15–30-minute design that made the earlier finding genuinely critical). A sequential scan reading a handful of narrow columns from a table in the low-single-digit-millions-of-rows range, run once daily, off-peak, is a bounded, predictable, modest cost on any RDS instance sized for this workload — nothing like the "scan millions of rows on every dashboard request" pattern this whole architecture exists to avoid. The index becomes worth having once the table's grown enough (tens of millions of rows, or a measured scan time that's actually becoming a problem) that a full scan stops being cheap — a concrete, checkable trigger, not a vague "someday."

**8. Expected production impact if it were added anyway.** Reasoned from general Postgres behavior, not measured: `CREATE INDEX CONCURRENTLY` on a single non-unique `DATE` column, for a table in the 1–10M row range, typically completes in low minutes (`CONCURRENTLY` avoids blocking the crawler's own writes during the build, at the cost of a slower build than a locking `CREATE INDEX`). Storage overhead is small relative to table size for one narrow column. None of this is a reason to add it now — it's context for whenever the trigger in #7 is actually met.

**9. Not a business-analysis index — confirmed.** **Yes.** Every business-analysis query in this architecture reads from this platform's own precomputed tables (`product_metrics_daily`, `trend_snapshots`, etc.) — never from `flipkart_reviews`/`myntra_reviews` directly. This index, if and when it's ever added, would exist purely to make one narrow, internal, source-reconciliation query cheap — nothing a dashboard user's request path would ever touch.

**10. `updatedAt` must not be the change-detection cursor — still confirmed.** **Yes**, unchanged by this session's index discovery. The reason was never "no index exists" — it's that the crawler bumps `updatedAt` unconditionally on every re-crawl of every in-window review, whether or not content changed (Phase 2.6). An index doesn't change what a column *means*; it only changes how cheaply you can filter on it. Indexing `updatedAt` would have made the wrong query fast, not correct.

---

## The updatedAt Index — What It's Actually For

`idx_myntra_reviews_updatedat_id` already exists, and it's worth being precise about what it's legitimately good for, since "don't use it as a change-detection cursor" isn't the same claim as "it's useless."

> **Two different questions, one index.**
>
> *"Did this review's content change?"* — `updatedAt` cannot answer this; it bumps on every touch regardless of content (Phase 2.6). This is the question the change-detection step must answer via content-hash comparison, never via this column.
>
> *"Was this review touched by a recent crawl run?"* — `updatedAt` *can* answer this reliably, precisely because the crawler only ever touches rows inside its active lookback window. A row that's aged out of the window stops getting its `updatedAt` bumped. So `WHERE "updatedAt" >= (now − ~70 days)`, using the index that already exists, is a valid way to approximate "which rows are currently in the crawler's active window" — as a *candidacy* filter, not a change signal.

Given #7 above already concludes no index is needed for the `review_date`-based query at current scale, this doesn't change today's recommendation — a plain sequential scan on `review_date` is fine either way. But it's worth recording as an available, no-new-index fallback if the trigger in #7 is ever reached before a `review_date` index gets approved: `updatedAt`-based candidacy filtering is a legitimate stopgap, with one caveat — it couples correctness to an unstated behavioral assumption about the crawler (that it touches every in-window row on every run without gaps), rather than to a self-evident business field. `review_date` remains the more robust, more explainable choice for whenever an index is actually added.

---

## A Methodology Correction, For The Record

Every "verified from code" claim in the prior three documents about database *schema* (as opposed to business *logic*) should be read precisely: it means "verified what the crawler's Sequelize model declares," which is what `sync({alter:false})` guarantees gets created — it does not mean "verified everything that currently exists on the live table." Those turned out to be different things here. Business-logic claims (upsert behavior, hash generation, date parsing, the lookback-window mechanism) are unaffected — those are fully determined by the code that runs, not by what else might exist alongside it in the database. Worth carrying forward as a standing caveat rather than a one-off footnote.

---

## Verdict

> **Proceed without the index.** No new production index is required to implement the Phase 2.6 reconciliation design at current or near-term scale. A sequential scan on `review_date`, run once daily as part of a bounded reconciliation job, is a modest, predictable cost — not the kind of repeated, frequent, large-scan pattern this architecture is built to avoid. **Revisit trigger:** once Phase 1 backfill gives real row counts and the reconciliation job has real measured scan times, add `(review_date)` on Myntra if and when that measurement — not a guess — shows it's worth it. Nothing here is **USER APPROVAL REQUIRED** today.

---

*Analysis only — no index created, no table modified, no crawler code touched. This revises Phase 2.6's index recommendation from "one small index, needed" to "no index needed yet, with a concrete measurable trigger for later."*

*Source: [Reconciliation index analysis artifact](https://claude.ai/code/artifact/9b12d9f5-8680-4012-b816-e6155724cc5c)*
