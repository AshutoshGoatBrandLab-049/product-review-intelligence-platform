# Phase 1: READ-ONLY Inspection Findings

**Date:** 2026-08-20  
**Status:** INSPECTION COMPLETE - CRITICAL GAPS IDENTIFIED  

---

## Summary

I have inspected how Myntra data flows through the ingestion pipeline. **A critical design issue was discovered that would prevent data replacement from working correctly.**

---

## Architecture Overview (Verified)

### Ingestion Pipeline

**TrackA (New Rows):**
- Query: `SELECT * FROM myntra_reviews WHERE id > lastSeenSourceId ORDER BY id`
- Indexed by: Primary key `id`
- Checkpoint: `IngestionWatermark.lastSeenSourceId` (per-platform)
- Behavior: Only processes rows WHERE `id > lastSeenSourceId`
- Event: Emits PRODUCT_DATA_UPDATED AFTER commit

**TrackB (Updates/Changes):**
- Query: `SELECT * FROM myntra_reviews WHERE review_date >= windowStart`
- Window: 70 days lookback (default)
- Comparison: Content-hash based (not `updatedAt`)
- Behavior: Detects actual content changes via hash mismatch
- Event: Emits PRODUCT_DATA_UPDATED AFTER commit

**Synchronization (Within Transaction):**
1. `synchronizeProductDimension()` - Updates product_dimension from normalized_reviews
2. `synchronizeProductDailyMetrics()` - Updates/deletes daily metrics from normalized_reviews

### Data Flow

```
myntra_reviews (source, read-only)
    ↓
TrackA (new) / TrackB (changes)
    ↓
normalized_reviews (canonical)
    ↓
product_dimension (upsert, no delete)
product_daily_metrics (upsert + delete stale)
    ↓
WebSocket events → Frontend → UI updates
```

---

## Critical Issue #1: Watermark Barrier

### Problem

**When `myntra_reviews` is completely deleted and replaced with new data:**

The `IngestionWatermark.lastSeenSourceId` still points to the old maximum ID.

If the new Myntra dataset has `id` values LOWER than the previous maximum (likely), TrackA will skip them:

```sql
-- Old watermark: lastSeenSourceId = 500000
SELECT * FROM myntra_reviews WHERE id > 500000  -- Returns NOTHING if new data has id < 500000
```

### Impact

- ✅ New reviews won't be imported (TrackA skips them)
- ✅ Changes won't be detected (TrackB scans by date, but would find stale rows in normalized_reviews)
- ✅ normalized_reviews accumulates stale data from old dataset
- ✅ product_dimension shows old product metadata
- ✅ product_daily_metrics has outdated metrics
- ✅ WebSocket events don't fire (no data changes detected)
- ✅ UI shows stale data

### Root Cause

TrackA uses **auto-incrementing primary key watermarking**, which assumes:
- New rows always have higher IDs than old rows ✅ (normally true)
- IDs never reset or reuse ✅ (normally true)
- IDs are monotonically increasing ✅ (normally true)

**This assumption breaks when the source table is completely replaced.**

### Current Code

```typescript
// trackA.ts line 56
let afterId = await getLastSeenSourceId(platform);  // Gets OLD watermark

// Then queries
const rawRows = platform === "flipkart"
  ? await prodReadOnly.getMyntraReviewsPage(afterId, batchSize);  // WHERE id > afterId
```

**No logic to reset/detect watermark staleness.**

---

## Critical Issue #2: No Explicit Cleanup for normalized_reviews

### Problem

**When source rows are deleted from myntra_reviews:**

The corresponding rows in `normalized_reviews` are NOT deleted.

### Impact

- Stale reviews remain in normalized_reviews
- These feed into product_dimension calculations (brand, count, dates)
- These feed into product_daily_metrics calculations (ratings, counts)
- UI shows metrics based on mixture of old + new data

### Example

```
OLD normalized_reviews for product P:
  - 50 reviews from old Myntra dataset

DELETE FROM myntra_reviews  -- Old data gone

NEW normalized_reviews for product P:
  - 50 stale reviews (from old data, still in table!)
  - 30 new reviews (from new data)

Product shows: Average rating across 80 reviews (50 old + 30 new = wrong)
```

### Current Code

**TrackA:**
- Inserts new reviews: `NormalizedReview.bulkCreate(toInsert, ignoreDuplicates: true)`
- No deletion logic

**TrackB:**
- Updates existing reviews if hash differs
- Inserts new reviews if not found
- No deletion logic

**synchronizeProductDimension:**
- Only UPSERTs product_dimension
- Does NOT delete stale product_dimension rows

**synchronizeProductDailyMetrics:**
- Deletes daily metrics rows with ZERO reviews ✅
- Does NOT delete entire products ✅

---

## Critical Issue #3: product_dimension Stale Rows

### Problem

**If all reviews for a product are deleted (e.g., entire product removed from new dataset):**

The `product_dimension` row for that product remains.

### Impact

- Product still appears in rankings/dashboards
- Shows old metrics (counts, brands, dates)
- No indication to user that product no longer has reviews

### Current Code

```typescript
// synchronize.ts - synchronizeProductDimension
if (!latestRow) return; // No reviews for this product
// ^ Exits silently, doesn't delete the product_dimension row
```

---

## Critical Issue #4: No Detection of Deleted Products

### Problem

When source dataset is completely replaced:

- Old products are gone
- No mechanism to detect "product was in old dataset, not in new dataset"
- product_dimension rows accumulate forever

### Impact

- Rankings show ghost products
- Metrics don't reflect current state
- Database grows with obsolete data

---

## What WOULD Work

**If new Myntra data had HIGHER IDs than old data:**
- TrackA would process them: `WHERE id > oldWatermark` ✅
- TrackB would find changes by date ✅
- New reviews would be added to normalized_reviews ✅

**Stale data would NOT be cleaned:**
- Old normalized_reviews rows remain ✅
- Old product_dimension rows remain ✅
- Metrics based on mixture of old+new data ✅

---

## What DOESN'T Work

**Complete source data replacement (current test requirement):**
- TrackA: Won't process new rows if they have lower IDs than old watermark
- TrackB: Scans by date window, but finds mixture of old+new in normalized_reviews
- Cleanup: No automatic deletion of stale data
- Metrics: Based on mixture of old+new reviews
- Product list: Includes old products no longer in new dataset

---

## Before Moving to Phase 2

**The following must be decided:**

1. **Watermark reset strategy:**
   - Should we reset `lastSeenSourceId = 0` before the test?
   - Should we implement auto-detection of empty result sets?
   - Should we require IDs to be continuous?

2. **Stale data cleanup:**
   - Should normalized_reviews rows be deleted when source rows are deleted?
   - Should product_dimension rows be deleted when all reviews are gone?
   - Should this be automatic during ingestion?

3. **Data replacement workflow:**
   - Is this a production scenario we need to support?
   - Or is this a test-only scenario?
   - How should we handle it?

---

## Verification Checklist (From Request)

### ✅ Verified

1. **How Myntra source rows are detected by TrackA**
   - Uses `id > lastSeenSourceId` with batch pagination
   
2. **How TrackB detects updated rows**
   - Uses content-hash comparison over date window
   
3. **How ingestion watermarks work**
   - `IngestionWatermark` table stores `lastSeenSourceId` per platform
   - Advanced in same transaction as insert
   
4. **How WebSocket events are generated**
   - PRODUCT_DATA_UPDATED emitted AFTER commit
   - One event per affected (platform, sourceProductId) pair
   
5. **How frontend receives events**
   - WebSocket client subscribes to events
   - useWebSocketEvent hooks fire callbacks
   
6. **Which UI pages update**
   - ProductRankingList: Updates product rows
   - ProductDetail: Silently refetches
   - AI Analyst: Protected (no updates)

### ❌ NOT Verified (Issues Found)

7. **What happens when source rows disappear**
   - ISSUE: normalized_reviews rows remain (not deleted)
   - ISSUE: product_dimension rows remain (not deleted)
   
8. **How newly inserted source rows are identified after complete delete/reinsert**
   - CRITICAL ISSUE: TrackA won't see them if they have lower IDs than watermark
   
9. **How normalized_reviews handles records that no longer exist in source**
   - ISSUE: Stale rows remain in table
   - ISSUE: They feed into metrics calculations
   
10. **How product_dimension handles missing products**
    - ISSUE: Stale rows remain in table
    - ISSUE: They appear in rankings/dashboards
    
11. **How product_daily_metrics handles removed reviews/products**
    - PARTIAL: Deletes metrics for dates with zero reviews ✅
    - ISSUE: Doesn't delete entire products
    
12. **Whether stale rows can remain**
    - YES: They remain in all three tables

---

## Gaps Requiring Fix Before Test

1. **Watermark reset** - Must reset or detect/handle empty datasets
2. **Stale normalized_reviews cleanup** - Must delete rows for deleted source reviews
3. **Stale product_dimension cleanup** - Must delete rows for products with no reviews
4. **ID continuity assumption** - Must handle non-monotonic IDs

---

## Recommendation for Test Execution

**STOP before Phase 2 until these gaps are addressed:**

Option A: **Implement automatic cleanup in ingestion**
- Add DELETE logic to TrackA for stale normalized_reviews
- Add DELETE logic to synchronizeProductDimension for products with zero reviews
- Add watermark reset detection

Option B: **Manual cleanup before test**
- Manually delete stale normalized_reviews rows before/after source replacement
- Manually delete stale product_dimension rows
- Manually reset watermark

Option C: **Use test data with higher IDs**
- Ensure new Myntra data has IDs > max(old Myntra IDs)
- Avoids watermark issue
- Stale data still remains (addresses Issues #2-3)

---

## Conclusion

**The infrastructure exists and works for normal incremental updates, but is NOT designed for complete source data replacement.**

**Before proceeding to Phase 2 (baseline capture), decide how to handle:**
1. Watermark reset/staleness
2. Cleanup of stale normalized_reviews
3. Cleanup of stale product_dimension
4. Whether this is a supported workflow

**Awaiting instruction on which approach to take.**

---

**Report completed:** 2026-08-20  
**Status:** READY FOR USER DECISION  
**No code modified during inspection**

