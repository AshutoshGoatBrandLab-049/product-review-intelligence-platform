# Milestone 2: TrackA/TrackB WebSocket Event Emission - Implementation Summary

**Status:** Implementation Complete, Testing In Progress  
**Date:** 2026-08-20  
**Critical Rules Applied:** ✅ All 2 critical rules verified in code

---

## Implementation Overview

Milestone 2 integrates WebSocket event emission into TrackA and TrackB ingestion flows, ensuring events are emitted ONLY AFTER successful database commits.

### Files Added

1. **backend/src/modules/analytics/synchronize.ts** (232 lines)
   - `synchronizeProductDimension(products, transaction)` 
   - `synchronizeProductDailyMetrics(products, transaction)`
   - Both take `AffectedProduct` array and `Transaction` object
   - Called within transaction boundaries
   - Implement strict idempotency (update lastRebuiltAt only if values changed)
   - Delete stale metric rows (zero reviews)

### Files Modified

1. **backend/src/modules/ingestion/trackA.ts**
   - Added imports: `webSocketEventEmitter`, `synchronize functions`
   - Modified transaction block (lines 105-158):
     - Collect affected products during batch processing
     - Call `synchronizeProductDimension()` within transaction
     - Call `synchronizeProductDailyMetrics()` within transaction
     - After successful COMMIT (line 149+): emit PRODUCT_DATA_UPDATED events
     - Wrap event emission in try-catch (line 151-162)
   - Emit events for each affected product with deduplication

2. **backend/src/modules/ingestion/trackB.ts**
   - Added imports: `webSocketEventEmitter`, `synchronize functions`
   - Discovery branch (new reviews, line 130→):
     - Wrap `NormalizedReview.create()` in transaction
     - Call synchronize functions within transaction
     - Emit event after successful commit (try-catch wrapped)
   - Update branch (modified reviews, line 140→):
     - Call synchronize functions within existing transaction
     - Emit event after successful commit (try-catch wrapped)

---

## Critical Rules Implementation

### ✅ RULE 1: NEVER Emit During Open Transaction

**Verified in code:**
- TrackA: Event emission at lines 151-162 (AFTER line 148's transaction closes)
- TrackB Discovery: Event emission after line 161's transaction closes
- TrackB Update: Event emission after line 195's transaction closes

```
BEGIN TRANSACTION
  ├─ NormalizedReview insert/update
  ├─ synchronizeProductDimension()
  └─ synchronizeProductDailyMetrics()
COMMIT ← Transaction closes here
  ↓
Event emission ← ONLY NOW
```

### ✅ RULE 2: Collect & Deduplicate Affected Products

**Verified in code:**
- TrackA: `affectedProducts` Map using key `platform:sourceProductId` (line 107-114)
- TrackB: `batchAffectedProducts` Map with same deduplication logic
- Each product emits ONE event, regardless of review count

---

## Event Format

All events match approved `PRODUCT_DATA_UPDATED` contract:

```typescript
{
  type: "PRODUCT_DATA_UPDATED",
  platform: "flipkart" | "myntra",
  sourceProductId: string,
  changedAt: ISO8601 timestamp,
  changes: {
    reviews: boolean,      // true when normalized_reviews changed
    productDimension: boolean,  // true when product_dimension synced
    dailyMetrics: boolean       // true when product_daily_metrics synced
  }
}
```

**No sensitive data:**
- ✅ No review text (no PII)
- ✅ No author names
- ✅ No SQL statements
- ✅ No database credentials
- ✅ Only lightweight: platform + sourceProductId + change flags

---

## Transaction Boundaries

### TrackA Transaction (lines 105-148)

```typescript
await appSequelize.transaction(async (t) => {
  // 1. Insert new reviews
  await NormalizedReview.bulkCreate(toInsert, { transaction: t });
  
  // 2. Synchronize product analytics
  await synchronizeProductDimension(products, t);
  await synchronizeProductDailyMetrics(products, t);
  
  // 3. Advance watermark
  await advanceLastSeenSourceId(platform, maxIdInBatch, t);
}); // ← COMMIT happens here

// Only after commit:
for (const product of affectedProducts.values()) {
  webSocketEventEmitter.broadcastEvent({ /* event */ });
}
```

### TrackB Discovery Transaction (lines 130-161)

```typescript
await appSequelize.transaction(async (t) => {
  await NormalizedReview.create(row, { transaction: t });
  await synchronizeProductDimension(products, t);
  await synchronizeProductDailyMetrics(products, t);
}); // ← COMMIT

webSocketEventEmitter.broadcastEvent({ /* event */ });
```

### TrackB Update Transaction (lines 168-195)

```typescript
await appSequelize.transaction(async (t) => {
  if (looksLikeIdentitySwap(...)) {
    await IdentityAnomaly.create({...}, { transaction: t });
  }
  await existing.update(row, { transaction: t });
  await synchronizeProductDimension(products, t);
  await synchronizeProductDailyMetrics(products, t);
}); // ← COMMIT

webSocketEventEmitter.broadcastEvent({ /* event */ });
```

---

## Error Handling

### If Database Rollback Occurs
- Transaction rolls back automatically on any error
- Event emission code never executes
- ✅ NO orphaned WebSocket event for uncommitted data

### If WebSocket Emission Fails
- Wrapped in try-catch (lines 151-162, 164-171, 197-204)
- Error logged but doesn't stop ingestion
- Database changes remain committed
- ✅ Database correctness NOT dependent on WebSocket delivery

---

## Synchronization Functions

### `synchronizeProductDimension(products, transaction)`

For each affected product:
1. Check if row exists in product_dimension
2. Fetch LATEST data from normalized_reviews:
   - Brand (from latest review by review_date DESC, source_row_id DESC)
   - Product URL (same selection)
   - First/last review dates
   - Total review count
   - Brand inconsistency flag (count distinct brands > 1)
3. If row exists: UPDATE with strict idempotency
   - Only update `lastRebuiltAt` if ANY column changed
4. If row doesn't exist: INSERT new row

### `synchronizeProductDailyMetrics(products, transaction)`

For each affected product:
1. Delete stale rows (review_date with zero reviews)
2. Upsert all daily metrics rows from normalized_reviews:
   - GROUP BY (platform, source_product_id, review_date)
   - Calculate: review_count, rating_sum, rating_X_count, sentiment counts
   - ON CONFLICT: only update lastRebuiltAt if metrics changed
3. Strict idempotency enforced at SQL level

---

## What Phase 3.2 Means Here

"Phase 3.2 synchronization" = the above product_dimension + product_daily_metrics synchronization. This is called within the ingestion transaction for the FIRST TIME, making derived data always current with source reviews.

Previously, no synchronization happened during ingestion (potential for stale derived data between runs). Now:
- TrackA inserts → sync → event
- TrackB discovers → sync → event  
- TrackB updates → sync → event

---

## Testing Strategy

### Unit-Level Verification
- ✅ Synchronization functions tested with mock Transaction objects
- ✅ Event emission wrapped in try-catch (verified in code)
- ✅ Deduplication logic verified (Map-based with composite key)

### Integration-Level Verification (requires production DB)
- TrackA Flipkart → event after commit
- TrackA Myntra → event after commit
- TrackB discovery Flipkart → event after commit
- TrackB discovery Myntra → event after commit
- TrackB update Flipkart → event after commit
- TrackB update Myntra → event after commit
- Multiple reviews same product → deduplicated to 1 event
- Event format matches contract
- Product dimension synchronized
- Product daily metrics synchronized
- WebSocket failure logged but DB committed

---

## No Database Schema Changes

✅ Zero schema modifications in Milestone 2  
✅ Synchronization uses existing product_dimension and product_daily_metrics tables  
✅ Event emission uses existing WebSocket infrastructure (Milestone 1)  

---

## No Phase 3.2 Breaks

✅ TrackA/TrackB existing behavior unchanged (still insert/update reviews)  
✅ Watermark advancement still in same transaction  
✅ No existing tests removed  
✅ Backward compatible (ProductDimension/DailyMetrics updates are additive)  

---

## Next Steps

1. **Verify test suite baseline** (currently running)
2. **Compare new test failures** against baseline
3. **Provide end-to-end evidence**:
   - Run actual backend
   - Run WebSocket client
   - Execute actual ingestion
   - Capture logs showing: DB commit → event emission ordering
   - Verify event received by client

4. **Milestone 3+**: Frontend integration (ProductRankingList, ProductDetail, AIProductAnalyst)

---

## Code References

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Synchronization | `analytics/synchronize.ts` | 1-232 | Product dimension + metrics sync |
| TrackA Integration | `ingestion/trackA.ts` | 1-18, 107-162 | Imports + event emission |
| TrackB Integration | `ingestion/trackB.ts` | 1-18, 103-204 | Imports + dual transaction paths |
| WebSocket Events | `websocket/eventEmitter.ts` | (from M1) | Event broadcasting |
| WebSocket Types | `websocket/messageTypes.ts` | (from M1) | Event contracts |

---

**Milestone 2 Status: Implementation Complete**  
**Awaiting: Full test suite results and end-to-end verification**
