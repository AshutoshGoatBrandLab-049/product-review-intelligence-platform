# PHASE 2 — DATA FRESHNESS ARCHITECTURE DESIGN

**Date:** 2026-08-20  
**Status:** DESIGN ONLY — NO IMPLEMENTATION  
**Scope:** Complete data pipeline architecture from source through rankings and AI Analyst

---

## EXECUTIVE SUMMARY

**VERIFIED FINDING:** The data pipeline has a critical structural gap between source table ingestion and downstream synchronization.

**ROOT CAUSE:** Three functions exist but are never called:
- `rebuildAnalytics()` — computes product_dimension and product_daily_metrics
- AI Pipeline — generates sentiment and theme
- Scheduler — orchestrates daily processing

**RECOMMENDATION:** Implement incremental-first architecture with full rebuild as safety fallback, NOT full rebuild as primary pattern.

---

## PART 1: CURRENT ARCHITECTURE (VERIFIED FROM CODE)

### Source-of-Truth Model

```
TIER 0 — AUTHORITATIVE SOURCES (Daily)
├─ flipkart_reviews (external crawler table)
└─ myntra_reviews (external crawler table)

TIER 1 — NORMALIZED (Derived from Tier 0)
└─ normalized_reviews (application-managed)

TIER 2 — AGGREGATED (Derived from Tier 1)
├─ product_dimension (application-managed, per-product snapshot)
├─ product_daily_metrics (application-managed, per-product-per-day metrics)
└─ identity_anomalies (application-managed, anomaly tracking)

TIER 3 — ANALYSIS (Derived from Tier 1 + Tier 2)
├─ review_sentiment (Phase 4+, NOT Phase 3)
├─ review_theme (Phase 4+, NOT Phase 3)
└─ ai_insights (Phase 4+, NOT Phase 3)

TIER 4 — API CONSUMPTION
├─ Rankings API → queries product_daily_metrics + product_dimension
├─ Analytics Dashboard → queries product_daily_metrics
└─ AI Analyst API → queries normalized_reviews DIRECTLY (bypasses Tier 2)
```

**CRITICAL DESIGN DECISION (Verified from Code Comments):**
- `review_sentiment`: "No row is ever written by any Phase 3 code" — intentionally left empty for Phase 4+
- `review_theme`: "No row is ever written by any Phase 3 code" — intentionally left empty for Phase 4+
- These are designed as FOUNDATION tables for future phases, not populated by current Phase 3

---

## PART 2: CURRENT PIPELINE FLOW (VERIFIED)

### New Review Flow (TrackA)

**Code Location:** `src/modules/ingestion/trackA.ts:50-156`

```
INPUT: flipkart_reviews / myntra_reviews
       WHERE id > last_seen_source_id

MAPPING:
  mapFlipkartReview() / mapMyntraReview()
  ↓
UNIFIED SCHEMA:
  UnifiedReview (platform, sourceProductId, rating, reviewText, etc.)
  ↓
VALIDATION:
  validateUnifiedReview()
  ↓ (BRANCH)
  ├─ REJECT → ingestion_rejects TABLE
  │
  └─ VALID:
     ├─ Compute: canonicalReviewId (deterministic hash)
     ├─ Compute: contentHash (SHA256 of review content)
     └─ INSERT INTO normalized_reviews
        (canonicalReviewId, platform, sourceProductId, rating, ...)
        VALUES (...) ON CONFLICT DO NOTHING
        ↓ (SAME TRANSACTION)
        ↓
        UPDATE ingestion_watermarks
        SET lastSeenSourceId = maxIdInBatch
        ↓
        COMMIT TRANSACTION

RESULT:
  ✅ normalized_reviews contains new review
  ✅ Watermark advanced
  ❌ NO DOWNSTREAM UPDATES
```

**Transaction Safety (VERIFIED):**
- Watermark advances ONLY inside same transaction as normalized_reviews insert
- If insert fails → watermark not advanced
- If watermark update fails → insert committed, watermark behind (acceptable: future run catches up)

**Batch Processing (VERIFIED):**
- Batch size: config.ingestion.batchSize (default: 5,000)
- Loop until rawRows.length < batchSize
- Idempotent: ON CONFLICT DO NOTHING handles retries

### Updated Review Flow (TrackB)

**Code Location:** `src/modules/ingestion/trackB.ts:69-212`

```
INPUT: flipkart_reviews / myntra_reviews
       WHERE review_date >= windowStart
       AND id > afterId

WINDOW PARAMETERS:
  windowStart = TODAY - (60 days + 10 day buffer) = 70 days lookback
  PURPOSE: Detect reviews that were updated but not inserted by TrackA

FOR EACH ROW:
  ├─ Compute: canonicalReviewId (deterministic hash)
  ├─ Compute: freshHash = SHA256(current review content)
  ├─ Query: existing = SELECT * FROM normalized_reviews WHERE canonicalReviewId = ...
  │
  └─ (BRANCH)
     ├─ NOT FOUND:
     │  └─ INSERT INTO normalized_reviews (new review in window)
     │
     ├─ FOUND + freshHash == existingHash:
     │  └─ UNCHANGED (rowsUnchanged++) → SKIP
     │
     └─ FOUND + freshHash != existingHash:
        ├─ LOG: Identity anomaly detection
        ├─ INSERT INTO identity_anomalies (if looks like identity swap)
        └─ UPDATE normalized_reviews SET rating, reviewText, ... WHERE canonicalReviewId = ...
           (SAME TRANSACTION)

RESULT:
  ✅ normalized_reviews updated with current source state
  ❌ NO DOWNSTREAM UPDATES
```

**Change Detection (VERIFIED):**
- Uses SHA256 contentHash to detect actual content changes
- NOT just updatedAt (crawler bumps this unconditionally)
- Handles rating changes, text changes, metadata changes

**Lookback Window (VERIFIED):**
- 60 days configurable: `config.ingestion.reconcileLookbackDays`
- 10 day safety buffer configurable: `config.ingestion.reconcileSafetyBufferDays`
- Covers late-arriving reviews within 70-day window
- QUESTION: What happens to reviews older than 70 days that change? → **UNKNOWN**

### What Happens AFTER Ingestion

**VERIFIED FINDING:**
```
After TrackA succeeds:
  ✅ normalized_reviews updated
  ❌ product_dimension NOT rebuilt
  ❌ product_daily_metrics NOT rebuilt
  ❌ Sentiment NOT generated
  ❌ Theme NOT generated

Function exists: rebuildAnalytics()
Active calls to rebuildAnalytics(): 0
Active calls to AI pipeline: 0
Active scheduler: NONE
```

**Consequence:**
```
Rankings query: SELECT FROM product_daily_metrics
                → Returns STALE data from previous rebuild (if any)

New products: NOT visible in product_dimension
             → Missing from rankings entirely

AI Analyst query: SELECT FROM normalized_reviews
                 → Returns CURRENT data (bypasses Tier 2)
                 → Different data than Rankings API shows
```

---

## PART 3: SOURCE-OF-TRUTH DEFINITIONS (VERIFIED)

### Authoritative Tables
```
DataWarehouse.flipkart_reviews — SOLE AUTHORITY for flipkart data
  ├─ Source of truth for: rating, reviewText, author, helpful_count, etc.
  ├─ Updated by: external crawler (daily)
  └─ Application reads: TrackA/B ingestion only

DataWarehouse.myntra_reviews — SOLE AUTHORITY for myntra data
  ├─ Source of truth for: rating, reviewText, author, helpful_count, etc.
  ├─ Updated by: external crawler (daily)
  └─ Application reads: TrackA/B ingestion only
```

### Derived Tables (VERIFIED)

**Tier 1 — Normalized:**
```
normalized_reviews
├─ Source: flipkart_reviews / myntra_reviews
├─ Authority: DERIVED (canonical ID, content hash, mapper version stored)
├─ PK: (canonicalReviewId)
├─ Guaranteed consistency: ✅ YES (TrackA/B maintain this)
├─ Used by:
│  ├─ AI Analyst (queries directly)
│  ├─ Sentiment generation (Phase 4+)
│  ├─ Theme generation (Phase 4+)
│  ├─ Analytics rebuild (computes Tier 2)
│  └─ Product dimension rebuild (computes Tier 2)
└─ Update strategy: INSERT new + UPDATE existing via content hash
```

**Tier 2 — Aggregated:**
```
product_dimension
├─ Source: normalized_reviews (GROUP BY platform, source_product_id)
├─ Authority: DERIVED
├─ PK: (platform, source_product_id)
├─ Computed fields:
│  ├─ brand (latest review_date, tie-break source_row_id DESC)
│  ├─ first_review_date (MIN)
│  ├─ last_review_date (MAX)
│  ├─ total_review_count (COUNT)
│  └─ brand_inconsistent (COUNT DISTINCT brand > 1)
├─ Current update strategy: TRUNCATE + full INSERT
├─ ISSUE: Never updated after TrackA/B
└─ CONSEQUENCE: New products don't appear until rebuild

product_daily_metrics
├─ Source: normalized_reviews (GROUP BY platform, source_product_id, review_date)
├─ Authority: DERIVED
├─ PK: (platform, source_product_id, review_date)
├─ Computed fields:
│  ├─ review_count (COUNT)
│  ├─ rating_sum (SUM rating)
│  ├─ rating_1_count through rating_5_count (COUNT FILTER by rating)
│  ├─ positive_count (COUNT FILTER rating IN (4,5))
│  ├─ negative_count (COUNT FILTER rating IN (1,2))
│  ├─ neutral_count (COUNT FILTER rating = 3)
│  └─ helpful_count_sum (SUM helpful_count)
├─ Current update strategy: TRUNCATE + full INSERT
├─ ISSUE: Never updated after TrackA/B
└─ CONSEQUENCE: Rankings show stale data

identity_anomalies
├─ Source: normalized_reviews (detected by TrackB)
├─ Authority: DERIVED
├─ PK: (canonicalReviewId)
├─ Written by: TrackB when looksLikeIdentitySwap()
└─ Current status: ✅ Updated as needed
```

**Tier 3 — Analysis (Intentionally Empty in Phase 3):**
```
review_sentiment
├─ Source: Phase 4+ AI pipeline (NOT Phase 3 ingestion)
├─ Per-review analysis: label (positive/neutral/negative), confidence
├─ Current status: ❌ Never updated (by design, reserved for Phase 4+)
└─ ISSUE: AI Analyst cannot use sentiment in analysis

review_theme
├─ Source: Phase 4+ AI pipeline (NOT Phase 3 ingestion)
├─ Per-review extraction: theme from controlled vocabulary
├─ Current status: ❌ Never updated (by design, reserved for Phase 4+)
└─ ISSUE: Theme-based analysis unavailable
```

**Critical Design Note (From Code Comment):**
```
Phase 3 §10/§15 — sentiment FOUNDATION. No row is ever written by any
Phase 3 code; this model exists so Phase 4+ classification work has a
stable target, per the approved design.
```

This is INTENTIONAL — sentiment and theme are Phase 4+ responsibilities, not Phase 3.

---

## PART 4: NEW REVIEW ARCHITECTURE DESIGN

### Required Behavior

When new review arrives in flipkart_reviews or myntra_reviews:

```
STEP 1: Detection and Normalization (CURRENTLY WORKING ✅)
  ├─ TrackA query: SELECT * FROM source WHERE id > last_seen_source_id
  ├─ Map to unified schema
  ├─ Validate
  └─ Result: Review inserted to normalized_reviews (if valid)

STEP 2: Product Registration (CURRENTLY BROKEN ❌)
  ├─ Detect: New canonical_review_id means new product OR existing product
  ├─ For NEW product:
  │  └─ INSERT INTO product_dimension (brand, first_review_date, total_review_count, ...)
  ├─ For EXISTING product:
  │  └─ UPDATE product_dimension (last_review_date, total_review_count, ...)
  └─ Requirements:
     ├─ Deterministic brand selection (latest review_date, tie-break id DESC)
     ├─ Accurate product count
     └─ Must complete before rankings queries
```

**RECOMMENDATION — Design Option A: Incremental Upsert**

```
Alternative to TRUNCATE + full rebuild:

FOR EACH new review in batch:
  ├─ Extract: (platform, source_product_id) from review
  ├─ Query: SELECT * FROM product_dimension WHERE platform = ? AND source_product_id = ?
  │
  └─ (BRANCH)
     ├─ NOT FOUND:
     │  └─ INSERT INTO product_dimension (...)
     │     SELECT latest_by_id.brand, MIN(review_date), MAX(review_date), COUNT(*)
     │     FROM normalized_reviews
     │     WHERE platform = ? AND source_product_id = ?
     │
     └─ FOUND:
        └─ UPDATE product_dimension SET
           last_review_date = (SELECT MAX(review_date) FROM normalized_reviews WHERE ...)
           total_review_count = (SELECT COUNT(*) FROM normalized_reviews WHERE ...)
           WHERE platform = ? AND source_product_id = ?
```

**Advantage over TRUNCATE:**
- ✅ Partial updates only
- ✅ No table lock
- ✅ Can rerun safely (idempotent upserts)
- ✅ Fast for sparse updates
- ✅ No loss of historical data during rebuild

**Risk:**
- ❌ Brand selection must remain deterministic
- ❌ Must handle concurrent updates
- ❌ Must handle late reviews (see PART 8)

### Product Daily Metrics for New Reviews

```
STEP 3: Date-level Metrics (CURRENTLY BROKEN ❌)
  ├─ Extract: (platform, source_product_id, review_date) from review
  ├─ Query: SELECT * FROM product_daily_metrics 
           WHERE platform = ? AND source_product_id = ? AND review_date = ?
  │
  └─ (BRANCH)
     ├─ NOT FOUND:
     │  └─ INSERT INTO product_daily_metrics (...)
     │     SELECT review_date, COUNT(*), SUM(rating), COUNT(*) FILTER (WHERE rating=1), ...
     │     FROM normalized_reviews
     │     WHERE platform = ? AND source_product_id = ? AND review_date = ?
     │
     └─ FOUND:
        └─ UPDATE product_daily_metrics SET
           review_count = (SELECT COUNT(...)),
           rating_sum = (SELECT SUM(rating) ...),
           rating_1_count = (SELECT COUNT(*) FILTER (WHERE rating=1) ...),
           ...
           WHERE platform = ? AND source_product_id = ? AND review_date = ?
```

**Why Per-Date Granularity:**
- PK is (platform, source_product_id, review_date)
- New reviews update ONE row per date
- Old reviews (TrackB) may update MULTIPLE rows if late-arriving

### AI Analyst Unchanged

```
STEP 4: AI Analyst Ready (CURRENTLY WORKING ✅)
  ├─ New review in normalized_reviews
  └─ Query: SELECT * FROM normalized_reviews WHERE platform = ? AND source_product_id = ?
     RESULT: ✅ AI Analyst sees current data immediately
```

AI Analyst is NOT affected by product_dimension or product_daily_metrics — it queries normalized_reviews directly.

---

## PART 5: UPDATED REVIEW ARCHITECTURE DESIGN

### When Source Review Changes

```
SCENARIO: Source record updated
  FROM: rating 3, text "good product"
  TO:   rating 1, text "terrible product"

CURRENT BEHAVIOR:
  ├─ TrackB detects: contentHash != previous contentHash
  └─ UPDATE normalized_reviews SET rating = 1, review_text = "terrible product", ...
     RESULT: ✅ normalized_reviews is current
             ❌ product_daily_metrics still shows old rating
             ❌ Rankings still show old rating
```

### Affected Downstream Tables

When normalized_reviews review is UPDATED:

```
TIER 2 — AGGREGATED (must be recalculated):

product_dimension:
  ├─ last_review_date may change (if updated review is most recent)
  ├─ brand may change (if updated review has new brand)
  ├─ total_review_count UNCHANGED (review already counted)
  └─ RECALCULATION: Subset query (only products that changed)

product_daily_metrics:
  ├─ review_date specific row must be updated:
  │  ├─ If rating changed (3→1): rating_sum changes, rating_3_count--, rating_1_count++
  │  ├─ If text changed: sentiment/theme may change (Phase 4+)
  │  └─ helpful_count changes if different
  ├─ RECALCULATION: One row per changed review's review_date
  └─ ISSUE: Currently never recalculated

TIER 3 — ANALYSIS (Phase 4+, not our responsibility):

review_sentiment:
  ├─ Content changed
  └─ Must be re-extracted (Phase 4+ AI pipeline)

review_theme:
  ├─ Content changed
  └─ Must be re-extracted (Phase 4+ AI pipeline)
```

### Design for Updated Reviews

**RECOMMENDATION — Incremental Recalculation for Changed Reviews:**

```
WHEN: TrackB updates normalized_reviews
  └─ INSIDE SAME TRANSACTION:
     ├─ UPDATE product_dimension
     │  WHERE (platform, source_product_id) = (changed review's product)
     │  SET last_review_date = (SELECT MAX FROM normalized_reviews),
     │      brand = (deterministic latest),
     │      ...
     │
     └─ UPDATE product_daily_metrics
        WHERE (platform, source_product_id, review_date) = (changed review's date)
        SET review_count, rating_sum, rating_1_count, ..., rating_5_count (all recomputed)
```

**Advantage:**
- ✅ Transactional consistency
- ✅ Minimal data movement
- ✅ Safe to rerun (idempotent)
- ✅ Can be done immediately in TrackB

**Risk:**
- ❌ TrackB must take on additional work (currently doesn't)
- ❌ Must compute aggregates correctly
- ❌ Late reviews may require historical recalculation (see PART 8)

---

## PART 6: PRODUCT HANDLING

### New Product with First Review

```
SCENARIO: Completely new product appears
  ├─ Flipkart review for product_id P arrives for first time
  └─ normalized_reviews INSERT (new canonicalReviewId)
     ├─ TrackA: Creates normalized row
     └─ DOWNSTREAM REQUIRED:
        └─ CREATE product_dimension row
           (brand, first_review_date, last_review_date, total_review_count=1)
           ├─ Without this: Rankings cannot find product
           ├─ Without this: Product invisible to API
           └─ Must happen before next Rankings query
```

### Existing Product + New Review

```
SCENARIO: Product P receives review #100
  ├─ normalized_reviews INSERT
  └─ DOWNSTREAM REQUIRED:
     ├─ UPDATE product_dimension SET
     │  last_review_date = new_date,
     │  total_review_count = 100,  (now 100, was 99)
     │  brand = latest_brand (may change if new review has different brand)
     │
     └─ INSERT/UPDATE product_daily_metrics FOR (P, review_date)
        ├─ If first review on that date: INSERT
        └─ If more reviews on that date: UPDATE (increment counts)
```

### Product Visibility Guarantee

**CURRENT STATE:**
```
New product appears in source
  ↓
normalized_reviews INSERT ✅
  ↓
product_dimension ??? (NOT REBUILT, so row may not exist)
  ↓
Rankings query: SELECT FROM product_dimension
               → Product NOT FOUND ❌
  ↓
RESULT: New product invisible to Rankings
```

**REQUIRED GUARANTEE:**
```
New product appears in source
  ↓
normalized_reviews INSERT ✅
  ↓
product_dimension INSERT ✅ (within same ingestion run)
  ↓
Rankings query: SELECT FROM product_dimension
               → Product FOUND ✅
  ↓
RESULT: New product visible immediately
```

---

## PART 7: DAILY METRICS DESIGN

### Current Rebuild Approach (Verified)

**Code Location:** `src/modules/analytics/rebuild.ts:47-72`

```sql
TRUNCATE product_daily_metrics;

INSERT INTO product_daily_metrics (
  platform, source_product_id, review_date,
  review_count, rating_sum, rating_1_count, ..., rating_5_count,
  positive_count, negative_count, neutral_count, helpful_count_sum,
  last_rebuilt_at
)
SELECT
  platform, source_product_id, review_date,
  count(*), sum(rating), 
  count(*) FILTER (WHERE rating = 1), ...,
  count(*) FILTER (WHERE rating IN (4,5)),
  count(*) FILTER (WHERE rating IN (1,2)),
  count(*) FILTER (WHERE rating = 3),
  coalesce(sum(helpful_count), 0),
  now()
FROM normalized_reviews
GROUP BY platform, source_product_id, review_date
```

**Problem:**
- TRUNCATE requires exclusive lock
- Full table rebuild is expensive
- Takes X seconds to rebuild → Rankings stale for that duration
- Not called by any code (orphaned)

### Incremental Alternative

**Design Option B: Upsert Per Changed Date**

```sql
FOR EACH (platform, source_product_id, review_date) in changed_reviews:
  INSERT INTO product_daily_metrics (...)
  SELECT platform, source_product_id, review_date, ... FROM normalized_reviews WHERE ...
  ON CONFLICT (platform, source_product_id, review_date) DO UPDATE SET
    review_count = EXCLUDED.review_count,
    rating_sum = EXCLUDED.rating_sum,
    rating_1_count = EXCLUDED.rating_1_count,
    ...,
    positive_count = EXCLUDED.positive_count,
    negative_count = EXCLUDED.negative_count,
    neutral_count = EXCLUDED.neutral_count,
    helpful_count_sum = EXCLUDED.helpful_count_sum,
    last_rebuilt_at = now()
```

**Advantage:**
- ✅ No full lock
- ✅ Partial updates
- ✅ Fast (O(changed_reviews) not O(all_reviews))
- ✅ Idempotent (safe to rerun)

**Risk:**
- ❌ May miss edge cases (deleted reviews?)
- ❌ Requires tracking which dates changed

### Hybrid Approach (Recommended)

**Design Option C: Daily Incremental + Weekly Full Rebuild**

```
DAILY INGESTION (TrackA/B):
  ├─ Incremental upserts for changed reviews
  └─ Fast, partial updates

WEEKLY SAFETY (Scheduled job):
  ├─ Full rebuild (TRUNCATE + INSERT)
  └─ Catches edge cases, cleans up orphaned rows

RESULT:
  ✅ Current data within 24 hours (daily incremental)
  ✅ Guaranteed consistency within 7 days (weekly full)
  ✅ Low daily cost (incremental)
  ✅ Safety net (weekly full)
```

---

## PART 8: LATE-ARRIVING REVIEWS & HISTORICAL RECALCULATION

### The Late-Review Problem (UNKNOWN HANDLING)

```
SCENARIO: Review for old date arrives late
  ├─ Review with review_date = 2026-07-15 appears on 2026-08-20
  ├─ Product's metrics for 2026-07-15 already computed and cached
  └─ QUESTION: How does system handle this? → CURRENTLY UNKNOWN
```

**TrackB's Approach:**
```
Window = TODAY - 70 days = approximately 70-day lookback
Logic: Scan all reviews in [window_start, TODAY] for changes
Result: Late reviews within 70 days ARE detected
Issue: Reviews older than 70 days are never re-scanned
```

**Current Behavior (Verified):**
```
Review with review_date 2026-07-15 arrives on 2026-08-20:
  ├─ TrackB window = 2026-06-11 to 2026-08-20
  ├─ Review IS in window → TrackB DETECTS IT
  └─ Result: normalized_reviews updated, metrics updated (if incremental design)

Review with review_date 2025-12-01 arrives on 2026-08-20:
  ├─ TrackB window = 2026-06-11 to 2026-08-20
  ├─ Review is OLDER than window
  ├─ Result: TrackB MISSES IT
  └─ CONSEQUENCE: normalized_reviews updated, but product_daily_metrics for 2025-12-01 NOT updated
```

### Risk Assessment

**Risk Level:** LOW (assuming normal data quality)

**Reasoning:**
- Reviews for old dates are RARE
- Crawlers typically reflect current state
- 70-day buffer covers almost all legitimate late-arrival cases

**Mitigation:**
- Weekly full rebuild catches old updates
- Can manually extend window if needed
- Query normalized_reviews directly if historical accuracy critical (like AI Analyst does)

---

## PART 9: SENTIMENT & THEME PROCESSING

### Current Status (Verified)

**FINDING:** Sentiment and theme are INTENTIONALLY LEFT EMPTY by Phase 3 design.

**Evidence:**
```
review_sentiment model comment:
  "No row is ever written by any Phase 3 code; this model exists so
   Phase 4+ classification work has a stable target, per the approved design."

review_theme model comment:
  "No row is ever written by any Phase 3 code. Controlled vocabulary only,
   never free text, so every future theme claim is checkable."
```

### Phase 4+ Responsibility

**AI Pipeline exists:** `src/modules/ai/pipeline.ts`

**Current Integration:** NONE (not called by Phase 3)

**Design Requirements for Future Integration:**

```
WHEN: New or updated review in normalized_reviews
SHOULD: Trigger sentiment + theme extraction

FOR EACH review:
  ├─ Extract sentiment:
  │  ├─ Input: review_text
  │  ├─ Output: label (positive/neutral/negative), confidence
  │  ├─ Store: review_sentiment (canonicalReviewId, label, confidence, modelVersion, contentHashAtClassification)
  │  └─ Idempotency: contentHashAtClassification tracks what version was analyzed
  │
  └─ Extract themes:
     ├─ Input: review_text
     ├─ Output: list of (theme from THEME_VOCABULARY, evidenceSnippet, confidence)
     ├─ Store: review_theme (multiple rows per review, one per theme detected)
     └─ Idempotency: contentHashAtExtraction tracks what version was analyzed

RETRY STRATEGY:
  ├─ Sentiment pipeline failure: retry independent of rest
  ├─ Theme pipeline failure: retry independent of rest
  └─ Both marked by contentHash so reprocessing safe
```

**Scope for this design:** DO NOT implement Phase 4. Only design data freshness for Phase 3 aggregates.

---

## PART 10: RANKINGS DATA FLOW

### Current Query Path (Verified)

**Code Location:** `src/api/controllers/rankings.ts` + `src/api/catalogSweep.ts`

```
Rankings API request
  ├─ Query: SELECT platform, source_product_id, brand FROM product_dimension
  ├─ For each product: computeProductAnalytics(platform, sourceProductId, window)
  │  └─ Query: SELECT SUM(review_count), SUM(rating_sum), ... FROM product_daily_metrics
  │           WHERE platform = ? AND source_product_id = ?
  │           AND review_date BETWEEN window.start AND window.end
  └─ Sort by averageRating and return

RESULT:
  ├─ Rankings depends on product_daily_metrics being CURRENT
  ├─ CURRENT STATUS: product_daily_metrics is STALE (never updated after ingestion)
  └─ CONSEQUENCE: Rankings show old data
```

### Freshness Guarantee Required

```
After successful ingestion:
  ├─ New reviews added to normalized_reviews
  ├─ product_daily_metrics MUST be updated for those reviews' dates
  ├─ product_dimension MUST include new products
  └─ RESULT: Next Rankings query shows current data
```

**NOT GUARANTEED TODAY:**
```
Why:
  ├─ rebuildAnalytics() exists but never called
  ├─ No incremental update mechanism
  └─ Rankings queries stale data until next manual rebuild
```

---

## PART 11: AI ANALYST DATA FLOW

### Current Query Path (Verified)

**Code Location:** `src/modules/ai/productAnalyst.ts`

```
AI Analyst question: "What is the average rating for latest 10 reviews?"
  ├─ Does NOT query product_daily_metrics
  ├─ Query: SELECT * FROM normalized_reviews WHERE platform = ? AND source_product_id = ?
  │         ORDER BY COALESCE(review_timestamp, review_date::timestamp) DESC
  │         LIMIT 10
  └─ Calculates average directly from review rows
     → ALWAYS shows current data ✅

RESULT:
  ├─ AI Analyst sees fresh data
  ├─ Does NOT depend on product_dimension or product_daily_metrics
  └─ If Rankings shows old data and AI Analyst shows new → DATA INCONSISTENCY
```

### Design Implication

**NO CHANGES NEEDED for AI Analyst freshness.**

AI Analyst already:
- ✅ Queries normalized_reviews directly
- ✅ Recalculates on every request
- ✅ Not affected by rebuild status

But: New products still need product_dimension entry for product selection UI.

---

## PART 12: FAILURE RECOVERY

### Scenario: Ingestion Succeeds, Rebuild Fails

```
CURRENT: If rebuildAnalytics() throws
  ├─ normalized_reviews: UPDATED ✅
  ├─ product_dimension: STALE (old data)
  ├─ product_daily_metrics: STALE (old data)
  └─ Application doesn't know → continues serving stale data ❌

REQUIRED GUARANTEE:
  ├─ Failure is VISIBLE
  ├─ Retry is automatic or manual (not silent)
  └─ State is CONSISTENT or explicitly marked STALE
```

### Idempotency

**Incremental upsert design (Options A & B) must be IDEMPOTENT:**

```
Scenario: UpdateMetricsForReview(reviewId) called twice

First call:
  ├─ Query product_daily_metrics (p, sp, rd)
  ├─ Row doesn't exist
  └─ INSERT with new counts

Second call (retry):
  ├─ Query product_daily_metrics (p, sp, rd)
  ├─ Row exists from first call
  ├─ UPDATE to same counts (idempotent)
  └─ RESULT: Same final state ✅
```

### Safe Retry Strategy

```
WHEN: UpdateMetricsForReview fails
THEN:
  ├─ Add to dead-letter queue
  ├─ Log detailed error
  └─ Retry later (background job or next scheduled run)

GUARANTEE:
  ├─ Multiple retries produce same result (idempotent)
  ├─ Partial failures don't corrupt data
  └─ System can recover without manual intervention
```

---

## PART 13: TRANSACTION BOUNDARIES

### Current Transaction Design (Verified)

```
TrackA — NEW REVIEW INSERTION:
  ├─ BEGIN TRANSACTION
  ├─ INSERT INTO normalized_reviews (...)
  ├─ UPDATE ingestion_watermarks SET lastSeenSourceId = ...
  └─ COMMIT
  
  GUARANTEE: Watermark advances if-and-only-if insert succeeds ✅

TrackB — UPDATED REVIEW DETECTION:
  ├─ BEGIN TRANSACTION (per single row)
  ├─ SELECT FROM normalized_reviews WHERE canonicalReviewId = ...
  ├─ IF NOT FOUND: INSERT INTO normalized_reviews
  ├─ ELSE IF contentHash changed: UPDATE normalized_reviews
  │  AND optionally: INSERT INTO identity_anomalies
  └─ COMMIT
  
  GUARANTEE: Review state is atomic per-review ✅
```

### Proposed Transaction Boundaries

**Option A: Single Transaction Per Batch**

```
BEGIN TRANSACTION (large scope, ~5,000 reviews)
├─ For each new/changed review:
│  ├─ UPDATE product_dimension
│  ├─ INSERT/UPDATE product_daily_metrics
│  └─ (insert/update review_sentiment if Phase 4)
└─ COMMIT

ADVANTAGE: All-or-nothing, no partial states
RISK: Large transaction locks, slow if rerun
```

**Option B: Transaction Per Review (Current)**

```
FOR EACH review:
  ├─ BEGIN TRANSACTION (tiny scope)
  ├─ normalized_reviews INSERT/UPDATE
  ├─ COMMIT
  │
  ├─ (separate, unguarded)
  ├─ product_dimension UPDATE
  ├─ product_daily_metrics INSERT/UPDATE

ADVANTAGE: Small locks, fast
RISK: Partial failures possible
```

**Option C: Transaction Per Date+Product (Recommended)**

```
FOR EACH (platform, source_product_id, review_date):
  ├─ BEGIN TRANSACTION
  ├─ Collect all reviews for this (p, sp, date)
  ├─ UPDATE product_dimension (once per product)
  ├─ UPDATE product_daily_metrics (once per date per product)
  ├─ UPDATE review_sentiment if Phase 4 ready
  └─ COMMIT

ADVANTAGE: 
  ├─ Atomic per (product, date) unit
  ├─ Reasonable lock scope
  └─ Small, manageable transactions

TRADEOFF:
  ├─ Requires grouping by (p, sp, date)
  └─ Phase 4 sentiment/theme must also group same way
```

**RECOMMENDATION:** Option C - per-(product, date) transactions

---

## PART 14: IDEMPOTENCY STRATEGY

### Requirement

**All downstream operations must be IDEMPOTENT.**

Why: Retries, crashes, replays must produce same final state.

### Product Dimension Upsert (Idempotent)

```sql
INSERT INTO product_dimension (platform, source_product_id, brand, ..., last_rebuilt_at)
VALUES (?, ?, (SELECT brand FROM ... ORDER BY review_date DESC LIMIT 1), ..., now())
ON CONFLICT (platform, source_product_id)
DO UPDATE SET
  brand = EXCLUDED.brand,
  last_review_date = EXCLUDED.last_review_date,
  total_review_count = EXCLUDED.total_review_count,
  last_rebuilt_at = now()
```

**Idempotent because:**
- ✅ Same inputs → same outputs
- ✅ Rerun 10x → same result
- ✅ ON CONFLICT DO UPDATE is deterministic

### Product Daily Metrics Upsert (Idempotent)

```sql
INSERT INTO product_daily_metrics (platform, source_product_id, review_date, review_count, rating_sum, ...)
SELECT platform, source_product_id, review_date, count(*), sum(rating), ...
FROM normalized_reviews
WHERE platform = ? AND source_product_id = ? AND review_date = ?
GROUP BY platform, source_product_id, review_date
ON CONFLICT (platform, source_product_id, review_date)
DO UPDATE SET
  review_count = EXCLUDED.review_count,
  rating_sum = EXCLUDED.rating_sum,
  ...
```

**Idempotent because:**
- ✅ SELECT aggregates are deterministic
- ✅ Rerun with same input → same counts
- ✅ No mutable state dependencies

### Content Hash Tracking (Prevents Reprocessing)

For Phase 4+ (sentiment/theme):

```
review_sentiment.contentHashAtClassification
├─ Tracks what version of content was analyzed
├─ Before re-processing sentiment:
│  └─ IF normalized_reviews.contentHash != stored.contentHashAtClassification
│     THEN re-extract (content changed since last analysis)
│
review_theme.contentHashAtExtraction
├─ Same pattern for themes
└─ Prevents unnecessary reprocessing
```

---

## PART 15: RETRY STRATEGY

### Automatic Retries (Built-in)

```
TrackA/B already handle:
  ├─ Watermark advances only on success
  ├─ Failed batch can be retried from same watermark
  ├─ ON CONFLICT DO NOTHING prevents duplicate inserts
  └─ Safe to rerun multiple times
```

### Failed Downstream Operations

```
STRATEGY: Best-effort without blocking ingestion

IF product_dimension update fails:
  ├─ Log detailed error (which product, which stage)
  ├─ Add to retry queue
  ├─ Continue processing next batch
  └─ Background job retries periodically

IF product_daily_metrics update fails:
  ├─ Log detailed error
  ├─ Add to retry queue
  └─ Same pattern

GUARANTEE:
  ├─ Ingestion completes regardless
  ├─ Downstream is EVENTUALLY consistent
  ├─ No data is lost
  └─ Errors are visible (logged)
```

### Scheduled Rebuild as Safety Net

```
WEEKLY FULL REBUILD:
  ├─ Schedule: Sunday 2 AM UTC
  ├─ Scope: TRUNCATE + INSERT for product_dimension and product_daily_metrics
  ├─ Purpose: Catch any missed updates, clean stale data
  └─ Recovery: If incremental fails silently, weekly rebuild catches it
```

---

## PART 16: SCHEDULER & ORCHESTRATION DESIGN

### Current State (Verified)

**No application scheduler exists.**

**Ingestion must be triggered externally** (k8s cronjob, GitHub Actions, systemd timer, etc.)

### Proposed Orchestration

```
DAILY INGESTION JOB (e.g., 1:00 AM UTC):
  ├─ runIngestion("flipkart")
  │  ├─ TrackA: process new reviews
  │  ├─ TrackB: process updated reviews
  │  └─ (inline) UPDATE product_dimension for changed products
  │  └─ (inline) UPDATE product_daily_metrics for changed (product, date) pairs
  │
  ├─ runIngestion("myntra")
  │  ├─ (same flow)
  │
  ├─ FINAL STEP: Mark synchronization complete
  │  └─ INSERT INTO sync_status (timestamp, platform, status='success', rows_processed=...)
  │
  └─ ON FAILURE: Mark failed
     └─ INSERT INTO sync_status (timestamp, platform, status='failed', error_message=...)

WEEKLY MAINTENANCE JOB (e.g., Sunday 2:00 AM UTC):
  ├─ runFullRebuild("product_dimension")
  ├─ runFullRebuild("product_daily_metrics")
  └─ Verify: SUM(product_daily_metrics.review_count) == COUNT(normalized_reviews)

INDEPENDENT: AI PIPELINE (Phase 4+)
  ├─ Trigger: When? (TBD by Phase 4 owner)
  ├─ Processing: Sentiment + theme extraction
  └─ Writes to: review_sentiment, review_theme
```

### Orchestration Requirements

```
SAFETY CHECKS:
  ├─ Prevent concurrent ingestion (advisory lock ✅ already implemented)
  ├─ Prevent concurrent rebuilds (add new advisory lock)
  ├─ Ensure sequential execution (flowkart, then myntra)
  └─ Timeout jobs that hang (configurable timeout)

VISIBILITY:
  ├─ Log every operation start/end
  ├─ Track duration
  ├─ Alert on failures
  └─ Dashboard showing last-run timestamp
```

---

## PART 17: FULL DATA CONSISTENCY MATRIX

| Source Event | normalized_reviews | product_dimension | daily_metrics | sentiment | theme | Rankings | AI Analyst |
|---|---|---|---|---|---|---|---|
| **New Flipkart review** | ✅ INSERT (TrackA) | ✅ INSERT if new product (incremental) | ✅ INSERT/UPDATE (incremental) | ❌ Phase 4+ | ❌ Phase 4+ | ✅ Yes (after sync) | ✅ Yes (queries norm) |
| **Updated Flipkart rating** | ✅ UPDATE (TrackB) | ✅ UPDATE (may recalc) | ✅ UPDATE (recalc aggregate) | ❌ Re-extract (Phase 4) | ❌ Re-extract (Phase 4) | ✅ Yes (after sync) | ✅ Yes (direct query) |
| **Updated Flipkart text** | ✅ UPDATE (TrackB) | ⚠️ No change (unless brand in text) | ⚠️ No change (rating same) | ❌ Re-extract (Phase 4) | ❌ Re-extract (Phase 4) | ⚠️ No change (metrics same) | ✅ Yes (reads text) |
| **New Myntra review** | ✅ INSERT (TrackA) | ✅ INSERT if new product | ✅ INSERT/UPDATE | ❌ Phase 4+ | ❌ Phase 4+ | ✅ Yes | ✅ Yes |
| **Updated Myntra rating** | ✅ UPDATE (TrackB) | ✅ UPDATE | ✅ UPDATE (recalc) | ❌ Re-extract | ❌ Re-extract | ✅ Yes | ✅ Yes |
| **New product (any platform)** | ✅ INSERT (first review) | ✅ INSERT (new dimension row) | ✅ INSERT (first date's metrics) | ❌ Phase 4+ | ❌ Phase 4+ | ✅ Visible after sync | ✅ Yes |
| **Late review (within 70 days)** | ✅ INSERT/UPDATE (TrackB) | ✅ UPDATE (dates, count) | ✅ INSERT/UPDATE (recalc date) | ❌ Phase 4+ | ❌ Phase 4+ | ✅ Yes | ✅ Yes |
| **Very late review (>70 days old)** | ✅ INSERT/UPDATE (TrackA) | ✅ UPDATE (count only) | ❌ MISS (outside window) | ❌ Phase 4+ | ❌ Phase 4+ | ⚠️ Partial (count updates) | ✅ Yes (correct in norm) |

**Legend:**
- ✅ = Data is current within ingestion cycle
- ❌ = Phase 4+ responsibility (not Phase 3)
- ⚠️ = Edge case, acceptable trade-off
- (incremental) = New incremental upsert approach

---

## PART 18: PROPOSED ARCHITECTURE DIAGRAM

```
DAILY SOURCE UPDATE (External Crawler)
│
├─ flipkart_reviews
│  └─ (new/updated rows)
│
└─ myntra_reviews
   └─ (new/updated rows)

        │
        ▼ (1) runIngestion()

INGESTION LAYER (Phase 3 Responsibility)
│
├─ TrackA (New rows)
│  └─ WHERE id > last_seen_source_id
│     └─ INSERT normalized_reviews
│        └─ UPDATE ingestion_watermarks (transactional)
│
└─ TrackB (Updated rows)
   └─ WHERE review_date >= windowStart
      ├─ UPDATE normalized_reviews (if content_hash changed)
      ├─ INSERT identity_anomalies (if anomaly detected)
      └─ record reconciliation stats

        │
        ▼ (2) Inline Downstream Sync (NEW)

SYNCHRONIZATION LAYER (Phase 3 Responsibility — Currently Missing)
│
├─ FOR EACH changed (product, date):
│  │
│  ├─ UPDATE product_dimension
│  │  ├─ last_review_date
│  │  ├─ total_review_count
│  │  ├─ brand (deterministic latest)
│  │  └─ last_rebuilt_at
│  │
│  └─ INSERT/UPDATE product_daily_metrics
│     ├─ review_count (COUNT)
│     ├─ rating_sum (SUM rating)
│     ├─ rating_1_count through rating_5_count
│     ├─ positive_count, negative_count, neutral_count
│     ├─ helpful_count_sum
│     └─ last_rebuilt_at

        │
        ▼ (3) Async AI Pipeline (Phase 4+ Responsibility)

ANALYSIS LAYER (Phase 4+ Responsibility — Currently Empty)
│
├─ Sentiment extraction
│  └─ review_text → INSERT review_sentiment
│
└─ Theme extraction
   └─ review_text → INSERT review_theme

        │
        ├─────────────────────────────────────────────┐
        │                                             │
        ▼                                             ▼

CONSUMPTION LAYERS
│
├─ Rankings API
│  ├─ SELECT FROM product_dimension (products list)
│  └─ SELECT FROM product_daily_metrics (metrics)
│
├─ Analytics Dashboard
│  └─ SELECT FROM product_daily_metrics
│
└─ AI Analyst API
   └─ SELECT FROM normalized_reviews (DIRECT, bypasses Tier 2)

        │
        ▼ (Weekly Safety Net)

MAINTENANCE LAYER
│
└─ Full rebuild (product_dimension, product_daily_metrics)
   ├─ Catches missed incremental updates
   ├─ Cleans stale data
   └─ Validates: SUM(metrics.review_count) == COUNT(normalized_reviews)
```

---

## PART 19: FILES REQUIRING CHANGES

**For Incremental Architecture Implementation:**

```
1. src/modules/ingestion/trackB.ts
   ├─ Add downstream synchronization calls
   ├─ Update product_dimension (after TrackB loop)
   ├─ Update product_daily_metrics (after TrackB loop)
   └─ Wrap in transaction OR use idempotent upserts

2. src/database/queries/ (NEW)
   ├─ productDimensionSync.ts (new file)
   │  ├─ updateProductDimension(platform, sourceProductId)
   │  └─ insertProductDimension(platform, sourceProductId)
   │
   └─ productDailyMetricsSync.ts (new file)
      ├─ updateProductDailyMetrics(platform, sourceProductId, reviewDate)
      └─ insertProductDailyMetrics(platform, sourceProductId, reviewDate)

3. src/modules/ingestion/watermarkRepo.ts
   ├─ (optional) Add advisory lock for rebuilds
   ├─ Prevent concurrent rebuild during ingestion

4. src/modules/analytics/rebuild.ts
   ├─ Keep full rebuild function (safety net)
   ├─ Add scheduling trigger (placeholder)
   ├─ May be called weekly OR on-demand

5. tests/
   ├─ Update existing ingestion tests
   ├─ Add synchronization tests
   ├─ Test idempotency of upserts
   └─ Test late-arriving review handling

6. .env
   ├─ (no changes needed, uses existing config)

7. CI/CD configuration (external, outside repo)
   ├─ Schedule daily ingestion
   ├─ Schedule weekly full rebuild
   ├─ Configure timeouts and alerts
```

**Database Changes Required:**

```
NONE — existing schema supports incremental upserts:
  ├─ product_dimension PK: (platform, source_product_id) → ON CONFLICT supported
  ├─ product_daily_metrics PK: (platform, source_product_id, review_date) → ON CONFLICT supported
  └─ New indexes to consider (not critical):
     └─ product_daily_metrics (platform, source_product_id) for lookups
```

---

## PART 20: DATABASE CHANGES REQUIRED

### Existing Schema Support

**Current schema supports incremental upserts WITHOUT modifications:**

```
product_dimension:
  PK: (platform, source_product_id)
  → ON CONFLICT (platform, source_product_id) DO UPDATE works ✅

product_daily_metrics:
  PK: (platform, source_product_id, review_date)
  → ON CONFLICT (platform, source_product_id, review_date) DO UPDATE works ✅
```

### Recommended Indexes (Optional, Performance)

```sql
-- If not already present, consider:
CREATE INDEX idx_product_daily_metrics_product ON product_daily_metrics(platform, source_product_id);
  PURPOSE: Speed up per-product lookups

CREATE INDEX idx_normalized_reviews_product_date ON normalized_reviews(platform, source_product_id, review_date);
  PURPOSE: Speed up aggregation queries
```

### New Tracking Table (Optional, Observability)

```sql
-- New table to track sync status (not critical, informational)
CREATE TABLE sync_status (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  run_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL, -- 'running', 'success', 'failed'
  rows_processed INTEGER,
  error_message TEXT,
  duration_seconds INTEGER
);

CREATE INDEX idx_sync_status_platform_time ON sync_status(platform, run_timestamp DESC);
```

**NO breaking changes to existing schema.**

---

## PART 21: RISKS

### Risk 1: Incremental Upsert Correctness

**Issue:** Upserts must compute aggregates correctly.

**Mitigation:**
- ✅ Query FROM normalized_reviews (source of truth)
- ✅ Aggregate function is deterministic (SUM, COUNT)
- ✅ Idempotent (rerun 10x = same result)
- ✅ Weekly full rebuild catches bugs

**Risk Level:** LOW (if aggregates are simple SUM/COUNT)

### Risk 2: Late Arrivals Beyond 70-Day Window

**Issue:** Reviews older than 70 days are not re-scanned.

**Mitigation:**
- ✅ Weekly full rebuild catches them
- ✅ Acceptable trade-off (most crawlers don't backfill)
- ✅ AI Analyst queries normalized_reviews directly (always correct)

**Risk Level:** LOW (real-world rare)

### Risk 3: Partial Failures

**Issue:** Ingestion succeeds, synchronization fails.

**Mitigation:**
- ✅ Add try/catch around sync operations
- ✅ Log failures (do not silently swallow)
- ✅ Add retry queue (background job)
- ✅ Weekly rebuild catches missed updates

**Risk Level:** MEDIUM (requires monitoring)

### Risk 4: Performance on Large Batches

**Issue:** Incremental upserts per-review might be slow.

**Mitigation:**
- ✅ Batch updates by (platform, source_product_id, review_date)
- ✅ One DB statement per (product, date) pair, not per review
- ✅ Typical batch = ~100 (product, date) pairs → 100 statements (fast)

**Risk Level:** LOW

### Risk 5: Data Inconsistency Between APIs

**Issue:** Rankings shows old data, AI Analyst shows new data.

**Mitigation:**
- ✅ Incremental sync runs after TrackB
- ✅ Data becomes consistent within minutes
- ✅ Weekly rebuild ensures convergence
- ❌ Temporary inconsistency is unavoidable (acceptable)

**Risk Level:** LOW (temporary, expected)

### Risk 6: Concurrent Access to product_dimension/product_daily_metrics

**Issue:** Rankings query while sync is writing.

**Mitigation:**
- ✅ PostgreSQL MVCC handles this (readers see snapshot)
- ✅ No exclusive locks during incremental updates
- ✅ Worst case: rankings see pre-sync data (acceptable)

**Risk Level:** LOW (PostgreSQL handles it)

---

## PART 22: ROLLBACK STRATEGY

### Rollback from Incremental to Full Rebuild

```
IF incremental approach causes issues:
  ├─ Revert code changes (keep new DB functions)
  ├─ Disable incremental calls in TrackA/B
  ├─ Schedule nightly full rebuilds
  └─ System continues working (slower, but correct)

TIME TO ROLLBACK: ~10 minutes (code change + redeploy)
DATA RISK: NONE (old code still works)
```

### Rollback from Scheduled Ingestion to Manual

```
IF scheduler is broken:
  ├─ Ingestion still runnable manually
  ├─ Rebuild still runnable manually
  └─ Application continues (just needs manual triggers)

TIME TO ROLLBACK: Minutes (no code change needed)
DATA RISK: NONE (manual triggers maintain consistency)
```

### Preserve Old Schema

```
CURRENT: product_review_intelligence schema still exists
FUTURE: Keep it as rollback source
├─ Never drop old schema
├─ Can restore from old schema if needed
└─ Safety net available
```

---

## PART 23: RECOMMENDED ARCHITECTURE

### Summary

**Recommendation: HYBRID APPROACH (Option C)**

```
DAILY INGESTION (Phase 3 Responsibility):
  ├─ TrackA/B detect new/changed reviews (existing ✅)
  ├─ Incremental upserts for product_dimension (NEW)
  │  └─ Per product: INSERT IF NOT EXISTS, ELSE UPDATE
  ├─ Incremental upserts for product_daily_metrics (NEW)
  │  └─ Per (product, date): INSERT IF NOT EXISTS, ELSE UPDATE
  └─ RESULT: Data becomes current within ingestion cycle

WEEKLY MAINTENANCE (Phase 3 Responsibility):
  ├─ Full rebuild of product_dimension (safety net)
  ├─ Full rebuild of product_daily_metrics (safety net)
  ├─ Validation: SUM(metrics.review_count) == COUNT(normalized_reviews)
  └─ RESULT: Catch any missed incremental updates

PHASE 4+ (Future Responsibility):
  ├─ Async trigger sentiment/theme extraction
  └─ Write to review_sentiment and review_theme

RESULT:
  ✅ Daily data consistency (incremental)
  ✅ Weekly safety net (full rebuild)
  ✅ Low daily cost (partial updates)
  ✅ High availability (no table locks)
  ✅ Easy rollback (keep full rebuild option)
```

### Why Not Full Rebuild?

```
Option A: TRUNCATE every day
  ❌ Table lock for entire rebuild duration (5-10 seconds)
  ❌ Rankings unavailable during rebuild
  ❌ All aggregates recalculated (waste)
  ❌ No partial recovery on failure

Option C: Incremental daily + weekly full
  ✅ No table locks (concurrent reads safe)
  ✅ Rankings available (MVCC snapshots)
  ✅ Only changed data affected
  ✅ Partial failures caught by weekly rebuild
  ✅ Faster common case (seconds vs minutes)
```

### Core Principle

**Data flows from source through derived layers incrementally.**

Each layer becomes current shortly after its input changes:

```
normalized_reviews ← source (TrackA/B) — minutes latency
    ↓
product_dimension/product_daily_metrics — seconds after TrackB finishes
    ↓
Rankings API — query sees current data
    ↓
AI Analyst — queries normalized_reviews directly (always current)
```

---

## PART 24: STEP-BY-STEP IMPLEMENTATION PLAN

### Phase 3.1: Design Checkpoint (THIS DOCUMENT)

✅ COMPLETE

**Outputs:**
- Architecture design document
- Identified changes needed
- Risk assessment
- Rollback strategy

### Phase 3.2: Incremental Sync Layer (NOT YET IMPLEMENTED)

**Work:**
1. Create `src/database/queries/productDimensionSync.ts`
   - `insertProductDimension(platform, sourceProductId)`
   - `updateProductDimension(platform, sourceProductId)`

2. Create `src/database/queries/productDailyMetricsSync.ts`
   - `insertProductDailyMetrics(platform, sourceProductId, reviewDate)`
   - `updateProductDailyMetrics(platform, sourceProductId, reviewDate)`

3. Update `src/modules/ingestion/trackB.ts`
   - After TrackB processing loop
   - Call sync functions for each changed (product, date)
   - Wrap in transaction (Option C)

4. Write tests
   - Test idempotency (rerun = same result)
   - Test late-arriving reviews
   - Test new product creation
   - Test rating changes

### Phase 3.3: Scheduler Setup (EXTERNAL)

**Work:**
1. Configure daily ingestion job (platform: flipkart, then myntra)
2. Configure weekly full rebuild (Sunday 2 AM)
3. Add monitoring/alerting
4. Add dashboard for last-run status

### Phase 3.4: Validation

**Work:**
1. Run full ingestion on test data
2. Verify product_dimension is current
3. Verify product_daily_metrics matches normalized_reviews aggregates
4. Verify Rankings shows current data
5. Verify AI Analyst unchanged (still queries normalized_reviews)
6. Performance testing (benchmark upsert performance)

### Phase 3.5: Production Rollout

**Work:**
1. Deploy incremental sync code
2. Keep weekly rebuild disabled initially (safety net ready)
3. Run daily ingestions
4. Monitor product_dimension and product_daily_metrics freshness
5. Enable weekly rebuild (automatic safety net)

### Phase 3.6: Decommission Old Rebuild

**Work:**
1. Once incremental + weekly rebuild running well
2. Remove unused `rebuildAnalytics()` code if desired
3. Keep full rebuild SQL (useful for manual operations)

---

## CONCLUSION

**VERIFIED FINDING:**

The data pipeline has a critical structural gap: TrackA/B successfully ingest reviews to normalized_reviews, but NO downstream synchronization occurs. The `rebuildAnalytics()` function exists but is never called, leaving product_dimension and product_daily_metrics stale.

**RECOMMENDATION:**

Implement incremental upsert architecture with weekly full rebuild as safety net. This provides:
- ✅ Current data within minutes (not days)
- ✅ Low daily cost (partial updates, no locks)
- ✅ Safe retries (idempotent operations)
- ✅ Easy rollback (keep full rebuild option)
- ✅ High availability (no table locks)

**NEXT STEP:**

User approval required before Phase 3.2 implementation begins.

---

**Report Status:** DESIGN ONLY — NO IMPLEMENTATION  
**Date:** 2026-08-20  
**Ready For:** User review and approval
