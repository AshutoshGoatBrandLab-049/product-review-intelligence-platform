# Phase 2A: Implementation Design - Source Data Replacement Handling

**Date:** 2026-08-20  
**Status:** AWAITING APPROVAL BEFORE IMPLEMENTATION  
**Goal:** Support complete Myntra source-data replacement with full data consistency  

---

## Design Overview

The implementation will add source-replacement detection and automatic stale-data cleanup to the existing ingestion pipeline. It preserves incremental update behavior while correctly handling complete dataset replacements.

### Core Strategy

1. **Detect genuine source replacement** — Not just "no new rows today"
2. **Clean stale data atomically** — Within same transaction as new ingestion
3. **Maintain transaction safety** — All-or-nothing semantics
4. **Preserve Flipkart data** — Only touch Myntra
5. **Emit WebSocket events** — Only after successful commit

---

## Problem to Solve

### Current Failure Mode

When `myntra_reviews` is completely replaced:

```
OLD DATA: myntra_reviews with id=1..500000
  ↓
TrackA watermark: lastSeenSourceId = 500000

DELETE FROM myntra_reviews;
INSERT INTO myntra_reviews (new data with id=1..50000)

Run TrackA:
  Query: SELECT * FROM myntra_reviews WHERE id > 500000
  Result: EMPTY (no rows, because new max id = 50000 < watermark)
  
NEW DATA NEVER IMPORTED ✗
```

### Why Simple "Reset on Zero Rows" Won't Work

```
Day 1: Incremental update, new rows added (id=500001..500100)
  TrackA: SELECT WHERE id > 500000 → 100 rows ✓

Day 2: Complete replacement (new data: id=1..50000)
  TrackA: SELECT WHERE id > 500000 → 0 rows
  
If we reset watermark to 0 whenever we see 0 rows:
  BUT what if Day 1 had no updates? False positive reset.
  
SOLUTION: Detect replacement by comparing source vs. canonical data,
not just by watermark behavior.
```

---

## Solution: Source Verification

### Replacement Detection Mechanism

**When TrackA finds zero new rows:**

Instead of blindly resetting, compare actual data:

```typescript
async function detectSourceReplacement(platform: Platform): Promise<boolean> {
  // Get count from source
  const sourceCount = await getReviewCount(platform);  // e.g., 50000
  
  // Get count from canonical
  const canonicalCount = await getNormalizedReviewCount(platform);  // e.g., 500000
  
  // Get max ID from each
  const sourceMaxId = await getSourceMaxId(platform);      // e.g., 50000
  const canonicalMaxSourceRowId = await getMaxSourceRowId(platform);  // e.g., 500000
  
  // Heuristic: replacement if source is much smaller AND max ID is lower
  // but BOTH tables have data (not a startup condition)
  return sourceCount > 0 && canonicalCount > 0 && 
         sourceMaxId < canonicalMaxSourceRowId &&
         sourceCount < (canonicalCount * 0.5);  // Less than 50% of old count
}
```

**Why this works:**
- Normal deletion: Some data gone, but remaining IDs stay same ✓
- Source replacement: All old IDs gone, new smaller IDs appear ✓
- Startup/empty: source or canonical is 0, so condition fails ✓
- Normal incremental: sourceMaxId > old watermark, so condition fails ✓

### Safety Characteristics

- Deterministic: Same source state → same detection result
- Idempotent: Running again with no changes = no-op
- Conservative: Only acts when genuinely convinced
- Reversible: Doesn't immediately delete; confirms via data inspection
- Platform-scoped: Only affects detected platform (e.g., Myntra, not Flipkart)

---

## Data Cleanup Strategy

### Phase 1: Identify Stale Myntra Reviews

Find reviews in `normalized_reviews WHERE platform='myntra'` that **no longer exist** in source:

```sql
-- Find canonical review IDs to delete
SELECT DISTINCT nr.canonical_review_id
FROM normalized_reviews nr
WHERE nr.platform = 'myntra'
  AND NOT EXISTS (
    SELECT 1 FROM myntra_reviews mr
    WHERE mr.product_id = nr.source_product_id
      AND mr.review_id = nr.source_review_id
  )
```

**Transaction safety:** Execute within same transaction as new ingestion.

### Phase 2: Delete Stale Normalized Reviews

```sql
DELETE FROM normalized_reviews
WHERE platform = 'myntra'
  AND canonical_review_id IN (... list from Phase 1)
```

### Phase 3: Delete Stale Product Dimensions

After normalized_reviews cleanup, identify products with zero reviews:

```sql
-- Products with no remaining reviews
SELECT DISTINCT platform, source_product_id
FROM product_dimension
WHERE platform = 'myntra'
  AND NOT EXISTS (
    SELECT 1 FROM normalized_reviews nr
    WHERE nr.platform = product_dimension.platform
      AND nr.source_product_id = product_dimension.source_product_id
  )
```

Delete those rows:

```sql
DELETE FROM product_dimension
WHERE platform = 'myntra'
  AND (platform, source_product_id) IN (... list)
```

### Phase 4: Delete Stale Daily Metrics

Same logic as product_dimension:

```sql
DELETE FROM product_daily_metrics
WHERE platform = 'myntra'
  AND NOT EXISTS (
    SELECT 1 FROM normalized_reviews nr
    WHERE nr.platform = product_daily_metrics.platform
      AND nr.source_product_id = product_daily_metrics.source_product_id
      AND nr.review_date = product_daily_metrics.review_date
  )
```

### Phase 5: Rebuild Dimensions for Affected Products

After cleanup, use existing synchronization logic:

- For each (platform='myntra', sourceProductId) with any reviews in normalized_reviews
- Call `synchronizeProductDimension()` to ensure current data
- Call `synchronizeProductDailyMetrics()` to ensure current data

---

## Watermark Management

### When Normal Ingestion

Standard behavior (no change):
1. TrackA: Read WHERE id > lastSeenSourceId
2. Insert to normalized_reviews
3. Advance watermark WITHIN same transaction
4. TrackB: Reconciliation over date window
5. Emit events AFTER commit

### When Replacement Detected

1. **Before starting ingestion:**
   - Detect replacement condition
   - Remember that replacement occurred

2. **During TrackA:**
   - Read ALL myntra_reviews (WHERE id > 0 instead of id > watermark)
   - This brings in "new" data that has lower IDs than old watermark
   - Insert to normalized_reviews (with ON CONFLICT DO NOTHING)
   - Set watermark to current MAX(id) from source

3. **After TrackA (same transaction):**
   - Run stale-data cleanup (Phases 1-4)
   - Synchronize affected products (Phase 5)
   - Watermark already at correct position

4. **After commit:**
   - Emit WebSocket events for affected products
   - Frontend receives events and refreshes

### Why This Works

```
BEFORE REPLACEMENT:
  normalized_reviews: 500k rows (old)
  watermark: 500000

AFTER REPLACEMENT:
  myntra_reviews: 50k rows (new)
  
TrackA runs:
  Step 1: Query: SELECT WHERE id > 0 (not id > 500000)
  Step 2: Insert new 50k rows
  Step 3: Delete 500k stale rows (Phases 1-5)
  Step 4: Watermark set to 50000
  Step 5: Commit
  
AFTER REPLACEMENT:
  normalized_reviews: 50k rows (new) ✓
  watermark: 50000 ✓
  Next run: TrackA queries WHERE id > 50000 ✓
```

---

## Implementation: Files to Create/Modify

### New File 1: `backend/src/modules/ingestion/sourceReplacement.ts`

**Purpose:** Detection and cleanup logic

**Exports:**
```typescript
export async function detectSourceReplacement(
  platform: Platform,
  transaction: Transaction
): Promise<boolean>

export async function cleanupStaleMyntraData(
  transaction: Transaction
): Promise<{
  staleReviewsDeleted: number;
  staleProductsDeleted: number;
  staleMetricsDeleted: number;
  affectedProducts: AffectedProduct[];
}>
```

**Key functions:**
- `getReviewCountByPlatform(platform)` — Count in source
- `getNormalizedCountByPlatform(platform)` — Count in canonical
- `getSourceMaxId(platform)` — Max ID in source
- `getMaxSourceRowIdInCanonical(platform)` — Max source_row_id in canonical
- `deleteStaleNormalizedReviews()` — Phase 1+2
- `deleteStaleProductDimension()` — Phase 3
- `deleteStaleProductDailyMetrics()` — Phase 4
- `identifyAffectedProducts()` — Which products changed

### Modified File 1: `backend/src/modules/ingestion/trackA.ts`

**Changes:**
1. Add replacement detection check at start
2. If replacement detected:
   - Query myntra with `id > 0` instead of `id > watermark`
   - Collect all inserted rows as "affected"
3. Within transaction:
   - Insert reviews
   - Run cleanup (if replacement detected)
   - Run synchronization for affected products
   - Advance watermark to current MAX(id)
4. After commit:
   - Emit events for affected products

**Lines changed:** ~80 additions (replacement logic branch)

### Modified File 2: `backend/src/modules/ingestion/trackB.ts`

**Changes:**
1. Skip if replacement was already detected in TrackA
   - (TrackB is reconciliation; if full ingestion just happened, skip TrackB)
   - OR run TrackB normally to catch any missed updates during TrackA

**Decision needed:** Should TrackB still run after replacement, or only if not replacement?
- **Recommended:** Run TrackB normally (date window scan is independent)

**Lines changed:** ~5 (conditional logic only)

### Modified File 3: `backend/src/modules/ingestion/runIngestion.ts`

**Changes:**
1. Pass transaction context through to TrackA
2. Log whether replacement was detected
3. No structural changes to flow

**Lines changed:** ~10

### Modified File 4: `backend/src/modules/websocket/eventEmitter.ts`

**Changes:** None (already emits events correctly)

---

## Transaction Boundaries

### The Atomic Boundary

**Everything within ONE transaction:**

```typescript
await appSequelize.transaction(async (t) => {
  // TrackA: insert new reviews
  await NormalizedReview.bulkCreate(toInsert, { transaction: t });
  
  // If replacement detected: cleanup stale data
  if (isReplacement) {
    const { affectedProducts } = await cleanupStaleMyntraData(t);
    
    // Synchronize affected products
    for (const product of affectedProducts) {
      await synchronizeProductDimension([product], t);
      await synchronizeProductDailyMetrics([product], t);
    }
  }
  
  // Advance watermark
  await advanceLastSeenSourceId('myntra', newWatermark, t);
});

// ONLY after commit: emit events
for (const product of affectedProducts) {
  webSocketEventEmitter.broadcastEvent({
    type: "PRODUCT_DATA_UPDATED",
    platform: "myntra",
    sourceProductId: product.sourceProductId,
    ...
  });
}
```

**Guarantees:**
- ✅ All changes commit together or all rollback
- ✅ Events only emitted after commit
- ✅ No partial updates visible to UI

---

## Scenarios Handled

| Scenario | TrackA | Cleanup | Result |
|----------|--------|---------|--------|
| New review | Inserts | No-op | ✓ Appears |
| Updated review | ON CONFLICT → no change | No-op | ✓ Already in canonical |
| Deleted review (incremental) | No-op | No-op | Remains (manual cleanup needed) |
| Deleted review (replacement) | No-op | Deletes | ✓ Removed |
| New product | Inserts reviews | Syncs | ✓ product_dimension created |
| Removed product (incremental) | No-op | No-op | Remains |
| Removed product (replacement) | No-op | Deletes | ✓ product_dimension deleted |
| Completely new dataset | Inserts all | Cleans old | ✓ Current state only |
| Normal day (no changes) | No-op | No-op | ✓ No-op |

---

## Testing Strategy

### Unit Tests

**File:** `backend/tests/unit/ingestion/sourceReplacement.test.ts`

Tests:
1. `detectSourceReplacement()` with various counts
2. Stale review detection and deletion
3. Stale product detection and deletion
4. Stale metrics detection and deletion
5. Watermark advancement
6. Transaction rollback on error

### Integration Tests

**File:** `backend/tests/integration/ingestion/replacementWorkflow.test.ts`

Tests:
1. Normal incremental ingestion (existing behavior)
2. Complete source replacement
3. Partial replacement (some products unchanged)
4. Replacement with products that moved between old/new dataset
5. Replacement with zero reviews → all stale

### E2E Browser Test

**File:** `tests/e2e/milestone4-myntra-replacement.js`

Tests:
1. Backup existing Myntra data
2. Delete and replace source data
3. Run ingestion
4. Verify WebSocket event emitted
5. Verify ProductRankingList updates without reload
6. Verify ProductDetail updates without reload
7. Verify stale data absent
8. Restore original data
9. Verify database back to baseline

---

## Risk Analysis

### Risks Mitigated

✅ **Watermark staleness:** Replaced by data-aware detection
✅ **Stale data in canonical:** Cleaned automatically
✅ **Transaction failure:** Full rollback on error
✅ **Partial updates:** All-or-nothing semantics
✅ **WebSocket fired before commit:** Emitted only after transaction
✅ **Flipkart affected:** Platform scoped (`WHERE platform = 'myntra'`)
✅ **Idempotency:** Detection is idempotent

### Remaining Risks (Low)

- **Very large datasets:** Cleanup queries scan all Myntra rows; could be slow
  - Mitigation: Use indexed queries, run during low-traffic hours
  - Acceptable: Runs once per replacement (not daily)

- **Concurrent access:** If two replacements run simultaneously
  - Mitigation: Ingestion has advisory lock per platform (already implemented)
  - Risk level: Negligible

### No Risks to

- Flipkart data (platform scoped)
- Other tables (not referenced)
- Existing incremental behavior (detection only acts on replacement condition)

---

## Rollback Plan

If implementation causes issues:

```bash
# 1. Remove sourceReplacement.ts
rm backend/src/modules/ingestion/sourceReplacement.ts

# 2. Revert changes to trackA.ts, trackB.ts, runIngestion.ts
git checkout HEAD -- \
  backend/src/modules/ingestion/trackA.ts \
  backend/src/modules/ingestion/trackB.ts \
  backend/src/modules/ingestion/runIngestion.ts

# 3. Redeploy
npm run build && npm run dev

# 4. Normal ingestion behavior restored
```

---

## Approval Checklist

**Before proceeding to implementation, confirm:**

- [ ] Source replacement detection mechanism is acceptable
- [ ] Data cleanup strategy is correct
- [ ] Transaction boundaries are sound
- [ ] Files to be modified are approved
- [ ] Test strategy covers all scenarios
- [ ] Risk analysis is acceptable
- [ ] Rollback plan is understood

---

## Next Steps

**If approved:**

1. PHASE 2B — Implementation (code changes)
2. PHASE 2C — Unit/integration testing
3. PHASE 2D — Real database replacement test (with data backup/restore)
4. PHASE 2E — Real WebSocket verification
5. PHASE 2F — Real browser E2E verification
6. PHASE 2G — Restore original database
7. PHASE 2H — Final evidence report

**Do NOT proceed until explicitly approved.**

---

**Report Status:** AWAITING APPROVAL  
**Date:** 2026-08-20  
**Complexity:** Moderate (4 files, ~100 LOC in productio code, ~500 LOC in tests)  
**Risk Level:** Low (scoped to Myntra, atomic transactions, backward compatible)

