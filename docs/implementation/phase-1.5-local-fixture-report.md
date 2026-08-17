# Phase 1.5 — Local Production-Like Data Environment — Report

**Scope:** Build a 100,000-row local development dataset in `gbl_data_lake.DataWarehouse.flipkart_reviews` / `.myntra_reviews`, entirely on the local Postgres instance, with zero production access. Supersedes the production-validation track of Phase 1.5 for now — that track (canary, query-plan validation, etc.) remains blocked on production credentials and is documented separately in `phase-1.5-validation-report.md`.

---

## Pre-work: schema inspection finding (resolved)

Before touching anything, I inspected `gbl_data_lake` and found `DataWarehouse` already exists as a large, populated schema — **347 tables, ~9.9M rows**, spanning many unrelated pipelines (Clickpost orders, Shopify checkouts, Amazon/Flipkart/Myntra crawler report tables for several brands). No table named exactly `flipkart_reviews` or `myntra_reviews` existed. Two structurally-similar tables did exist (`flipkart_crawler_ratings_reviews`, `myntra_crawler_review`) but weren't an exact match (the Flipkart one is missing `brand_name`, which our verified schema has). I flagged this and asked how to proceed rather than guessing; you confirmed: create new `flipkart_reviews`/`myntra_reviews` tables in this same shared schema, leaving everything else untouched. That's what happened below — nothing else in `DataWarehouse` was read, modified, or enumerated beyond the two target table names.

---

## 1–4. Row counts

| | Existing (before) | New rows inserted | Final |
|---|---|---|---|
| `DataWarehouse.flipkart_reviews` | 0 (table didn't exist) | 50,000 | **50,000** |
| `DataWarehouse.myntra_reviews` | 0 (table didn't exist) | 50,000 | **50,000** |

Both tables were created fresh by `scripts/seedLocalReviewFixtures.ts` — no pre-existing rows to preserve or account for.

---

## 5. Date distribution (Flipkart; Myntra generated with the same weighted buckets)

| Bucket | Target weight | Actual rows |
|---|---|---|
| 0–30 days | 20% | 10,111 |
| 31–60 days | 15% | 7,439 |
| 61–90 days | 15% | 7,481 |
| 3–6 months | 25% | 12,526 |
| 6–12 months | 25% | 12,443 |

Matches the requested distribution shape — no bucket is empty, no bucket dominates, and nothing defaults to "today."

---

## 6. Rating distribution

| Rating | Flipkart | Myntra |
|---|---|---|
| 1 | 5,981 | 5,918 |
| 2 | 4,568 | 4,421 |
| 3 | 6,976 | 6,664 |
| 4 | 13,506 | 13,002 |
| 5 | 18,969 | 19,995 |

Positive-skewed (roughly 65% 4★/5★), matching typical e-commerce rating shape, not a flat/uniform distribution.

---

## 7. Duplicate validation

- Flipkart `(pid, review_id)` duplicate pairs: **0 — PASS**
- Myntra `(product_id, review_id)` duplicate pairs: **0 — PASS**

(Also structurally enforced by each table's `UNIQUE` constraint — the insert would have failed outright on any collision.)

---

## 8. Required-field validation

- Flipkart rows with NULL `pid`/`review_id`/`rating`/`review_date`: **0 — PASS**
- Myntra rows with NULL `product_id`/`review_id`/`rating`/`review_date`: **0 — PASS**
- Rating out-of-range (not 1–5): **0 on both platforms — PASS**
- Product distribution: 500 distinct Flipkart `pid`s, 28–297 reviews per product (skewed, not uniform — some products have far more reviews than others, as requested)
- `updatedAt` realism: 5,632 Flipkart rows have `updatedAt` more than 10 days past `review_date` — the simulated crawler re-upsert behavior from §8 of your instructions, concentrated in reviews still inside the ~70-day reconciliation window

---

## 9. Fixture generation duration / 10. Insert performance

| Platform | Rows | Duration (generate + insert) | Rate |
|---|---|---|---|
| Flipkart | 50,000 | 4,079ms | 12,258 rows/sec |
| Myntra | 50,000 | 3,997ms | 12,509 rows/sec |

Batched inserts of 2,000 rows per statement (25 batches per platform) — never one giant single-statement insert.

---

## 11. Test results

Full existing suite re-run (unaffected by this work — it targets the isolated `pri_test_appstore`/`pri_test_prodsource` test databases, never the real `gbl_data_lake` this script wrote to):

```
Test Files  19 passed (19)
     Tests  97 passed (97)
```

---

## 12. Typecheck result

`npm run typecheck` — clean, zero errors.

---

## 13. Safety-check result

`npm run safety-check` — `OK — no write-shaped SQL found in database/prodReadOnly/.` (unchanged — this new script lives entirely outside `database/prodReadOnly/` and was never in scope for that scan; it's flagged instead by inspection here as writing only to `config.appStore`, never `config.prodReadOnly`.)

---

## 14. Schema mismatches

None against our own verified schema. The tables were created using the exact same DDL as the existing test fixtures (`src/database/fixtures/*.sql`), which were themselves sourced from the crawlers' own model files during Phase 1 discovery — not invented here. (The *other*, differently-shaped `flipkart_crawler_ratings_reviews` table found during inspection was not used and has no bearing on this schema.)

---

## 15. Assumptions made (explicit, per "do not guess" — flag, don't hide)

- Brand names, author names, and all URLs are entirely synthetic (fictional brand pool, common first/last name pool, `.local` fake domains) — deliberately not real companies, people, or resolvable links.
- Myntra `title` is always `NULL`, matching the mapper's documented note that Myntra's API has no title field upstream — not populated with a placeholder.
- The "re-upsert without content change" behavior (§8) is modeled by giving in-window rows a realistic chance of a recent `updatedAt` independent of their original content — not by literally re-writing rows after the fact, since a single deterministic seed pass achieves the same testable property (a row whose `updatedAt` doesn't match its `review_date` while every content field is exactly as generated).
- No `sentiment` column was added — sentiment is only implied through generated review text (theme + rating-driven phrasing), never stored, per your explicit instruction.
- Duplicate/idempotency test cases are exercised via the existing automated Track A/B test suite (already covers re-run idempotency, content-hash stability, and identity-anomaly detection) rather than injecting a second contaminated batch into this clean 50k/50k baseline — the DB's own unique constraints make literal duplicate rows impossible to insert here anyway.

---

## 16. Warnings

- `DataWarehouse` in this local database is a **shared, general-purpose warehouse** with 347 other tables unrelated to this project. This script only ever names `flipkart_reviews`/`myntra_reviews` explicitly — it does not scan, alter, or depend on anything else in that schema — but it's worth knowing this isn't an isolated sandbox the way `pri_test_prodsource` is.
- This dataset lives in the *real* local `gbl_data_lake` database (not the isolated `pri_test_*` databases), so it will persist across sessions and isn't cleaned up by the test suite's `resetAppStore` helper (which only touches `product_review_intelligence`). No cleanup script exists yet — per your safety rules, one would need to be a separately named, clearly-marked destructive script, created only when you ask for it.

---

## Content-hash / mapper / canonical-ID validation (§11 of your instructions)

Run in-process against real seeded rows, using the actual production mapper and hashing code (not reimplemented for this test):

```
[PASS] identical Flipkart review -> identical content_hash
[PASS] updatedAt-only change -> content_hash unchanged (Flipkart)
[PASS] rating change -> content_hash changes (Flipkart)
[PASS] review text change -> content_hash changes (Flipkart)
[PASS] updatedAt-only change -> content_hash unchanged (Myntra)
[PASS] helpful_count change -> content_hash changes (Myntra, meaningful-field case)
[PASS] identical (sourceProductId, sourceReviewId) on different platforms -> different canonical_review_id
```

All 7 checks pass — covers cases A, B, C/D, and E from your §11, plus the cross-platform canonical-ID distinctness from §10.

---

## Confirmation

```
PRODUCTION DATABASE ACCESSED: NO
PRODUCTION TABLES MODIFIED:   NONE
PRODUCTION TABLES CREATED:    NONE
PRODUCTION DATA MODIFIED:     NONE
```

Every connection this script made used `config.appStore` (`localhost:5432/gbl_data_lake`) exclusively. `config.prodReadOnly` / `DB_PROD_*` were never read, referenced, or connected to.

---

## Status

Local production-like dataset established and validated: 100,000 rows total (50,000/50,000), clean baseline, no duplicates, realistic distributions, `updatedAt`/`review_date` divergence modeled, content-hash and canonical-ID behavior proven against real seeded rows. Reproducible via `npm run seed:local-fixtures` (fixed seed = 42; re-running against the now-populated tables will detect existing data and stop rather than duplicate/overwrite).

**Stopping here — not proceeding to Phase 2, API, frontend, AI, or dashboard work, per instruction.**
