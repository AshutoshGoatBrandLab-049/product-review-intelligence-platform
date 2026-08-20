# Phase 2B.3-5: Implementation Specification

**Status:** PRE-IMPLEMENTATION VERIFICATION  
**Date:** 2026-08-20  

---

## PHASE 2B.3: Transaction Boundaries

### The Atomic Unit

**Everything in ONE transaction:**

```typescript
// IN: appSequelize.transaction(async (t) => { ... })

// 1. Process new reviews
if (toInsert.length > 0) {
  await NormalizedReview.bulkCreate(toInsert, { transaction: t });
}

// 2. Detect replacement
const isReplacement = await detectSourceReplacement('myntra', t);

// 3. If replacement: cleanup old data
if (isReplacement) {
  const { affectedProducts, staleReviewsDeleted } = 
    await cleanupStaleMyntraData(t);
    
  // 4. Synchronize affected products
  for (const product of affectedProducts) {
    await synchronizeProductDimension([product], t);
    await synchronizeProductDailyMetrics([product], t);
  }
}

// 5. Advance watermark
const newWatermark = getMaxIdFromToInsert(toInsert) || existingWatermark;
await advanceLastSeenSourceId('myntra', newWatermark, t);

// ^ COMMITS HERE if all succeed
// ^ ROLLS BACK EVERYTHING if any step fails

// OUT: })

// 6. ONLY AFTER COMMIT: emit events
for (const product of affectedProducts) {
  webSocketEventEmitter.broadcastEvent({
    type: "PRODUCT_DATA_UPDATED",
    platform: "myntra",
    sourceProductId: product.sourceProductId,
    changedAt: new Date().toISOString(),
    changes: {
      reviews: true,
      productDimension: true,
      dailyMetrics: true,
    },
  });
}
```

### Guarantees

| Scenario | Behavior | Evidence |
|----------|----------|----------|
| All steps succeed | COMMIT, emit events | ✓ Data visible to UI |
| Step 1 fails | ROLLBACK, no events | ✓ No partial writes |
| Step 3 fails | ROLLBACK, no events | ✓ Canonical unchanged |
| Step 4 fails | ROLLBACK, no events | ✓ Dimensions unchanged |
| Step 5 fails | ROLLBACK, no events | ✓ Watermark unchanged |
| Step 6 (event) fails | Logged, doesn't rollback | ✓ Data committed, event lost (acceptable) |

### Why This Works

1. **Transaction boundary:** Database sees atomic change
2. **Event ordering:** Events fire AFTER database commit
3. **Rollback safety:** No partial state visible
4. **Idempotency:** Retry-safe (ON CONFLICT DO NOTHING)

---

## PHASE 2B.4: Exact Files to Create/Modify

### NEW FILE: `backend/src/modules/ingestion/sourceReplacement.ts`

**Purpose:** Detect and cleanup stale Myntra data

**Exports:**

```typescript
export interface ReplacementCleanupResult {
  staleReviewsDeleted: number;
  staleProductsDeleted: number;
  staleMetricsDeleted: number;
  affectedProducts: AffectedProduct[];
}

export async function detectSourceReplacement(
  platform: 'myntra',
  transaction: Transaction
): Promise<boolean>

export async function cleanupStaleMyntraData(
  transaction: Transaction
): Promise<ReplacementCleanupResult>
```

**Internal functions:**

```typescript
// Detection helpers
async function getSourceReviewCount(): Promise<number>
async function getSourceMaxId(): Promise<number>
async function getCanonicalReviewCount(): Promise<number>
async function getCanonicalMaxSourceRowId(): Promise<number>
async function hasOverlappingIds(sourceMaxId: number): Promise<number>

// Cleanup helpers
async function identifyStaleReviewIds(t: Transaction): Promise<string[]>
async function deleteStaleNormalizedReviews(ids: string[], t: Transaction): Promise<number>
async function identifyStaleProducts(t: Transaction): Promise<{platform: string, sourceProductId: string}[]>
async function deleteStaleProductDimensions(products: Array<{platform: string, sourceProductId: string}>, t: Transaction): Promise<number>
async function deleteStaleProductMetrics(products: Array<{platform: string, sourceProductId: string}>, t: Transaction): Promise<number>
async function getAffectedProducts(t: Transaction): Promise<AffectedProduct[]>
```

**File size:** ~450 lines

---

### MODIFIED FILE: `backend/src/modules/ingestion/trackA.ts`

**Current flow:**
```
1. Get watermark
2. Loop: getMyntraReviewsPage(afterId, batchSize)
3. Process reviews
4. Insert to normalized_reviews
5. Advance watermark
6. Emit events
```

**New flow (WITH replacement handling):**
```
1. Get watermark
2. Loop: getMyntraReviewsPage(afterId, batchSize)
   a. If zero rows: check for replacement
   b. If replacement: special handling (see below)
3. Process reviews
4. Within transaction:
   a. Insert to normalized_reviews
   b. IF replacement: cleanup stale data
   c. IF replacement: synchronize products
   d. Advance watermark
5. Emit events
```

**Changes required:**

Line ~53: Import replacement module
```typescript
import { 
  detectSourceReplacement, 
  cleanupStaleMyntraData 
} from "./sourceReplacement.js";
```

Line ~72 (in runTrackA function): Add replacement detection
```typescript
let affectedProducts: AffectedProduct[] = [];
let isReplacement = false;

for (;;) {
  const rawRows = platform === "flipkart"
    ? await prodReadOnly.getFlipkartReviewsPage(afterId, batchSize)
    : await prodReadOnly.getMyntraReviewsPage(afterId, batchSize);

  // NEW: Check for replacement if no new rows
  if (rawRows.length === 0) {
    if (platform === 'myntra') {
      isReplacement = await detectSourceReplacement(platform, null); // null = outside transaction for detection
      if (isReplacement) {
        logger.info({ jobId, platform }, "Source replacement detected");
        // Need to re-query with id > 0 to get all current data
        afterId = -1; // This will become id > 0 in next iteration
        continue; // Re-enter loop to fetch with lower bound
      }
    }
    break; // No more rows and no replacement
  }
  // ... rest of loop
}
```

Actually, better approach - detect BEFORE loop:

```typescript
let isReplacement = false;
if (platform === 'myntra') {
  // Quick check: see if we have zero rows
  const firstBatch = await prodReadOnly.getMyntraReviewsPage(watermark, 1);
  if (firstBatch.length === 0) {
    // Check if replacement
    isReplacement = await detectSourceReplacement('myntra', null);
    if (isReplacement) {
      afterId = 0; // Reset to fetch all data
    }
  }
}

for (;;) {
  const rawRows = platform === "flipkart"
    ? await prodReadOnly.getFlipkartReviewsPage(afterId, batchSize)
    : await prodReadOnly.getMyntraReviewsPage(afterId, batchSize);
  // ... rest
}
```

Then within transaction:

```typescript
await appSequelize.transaction(async (t) => {
  if (toInsert.length > 0) {
    await NormalizedReview.bulkCreate(toInsert, { transaction: t });
    
    // NEW: If replacement detected, cleanup
    if (isReplacement) {
      const cleanupResult = await cleanupStaleMyntraData(t);
      affectedProducts = cleanupResult.affectedProducts;
      
      // Synchronize affected products
      if (affectedProducts.length > 0) {
        await synchronizeProductDimension(affectedProducts, t);
        await synchronizeProductDailyMetrics(affectedProducts, t);
      }
    } else {
      // Normal path: collect affected products from inserts
      affectedProducts = Array.from(new Map(
        toInsert.map(row => [`${row.platform}:${row.sourceProductId}`, {
          platform: row.platform,
          sourceProductId: row.sourceProductId,
        }])
      ).values());
      
      // Normal synchronization
      await synchronizeProductDimension(affectedProducts, t);
      await synchronizeProductDailyMetrics(affectedProducts, t);
    }
  }
  await advanceLastSeenSourceId(platform, maxIdInBatch, t);
});

// AFTER commit: emit events
for (const product of affectedProducts) {
  webSocketEventEmitter.broadcastEvent({...});
}
```

**File size change:** +80 lines (added within existing function)

---

### MODIFIED FILE: `backend/src/modules/ingestion/trackB.ts`

**Current behavior:** Reconciliation scan over date window

**New behavior:** Same (no changes needed)

**Rationale:** TrackB is independent reconciliation; it scans by date window regardless of whether replacement happened. If replacement was detected, TrackB will just verify nothing changed within its window (likely no-op).

**File size change:** 0 lines (no changes)

---

### MODIFIED FILE: `backend/src/modules/ingestion/runIngestion.ts`

**Current:** Calls TrackA and TrackB sequentially

**New:** Add logging for replacement detection

```typescript
// No structural changes needed; detection happens inside TrackA
// Just ensure logging captures replacement status from TrackA result
```

**File size change:** 0-5 lines (logging only)

---

### TEST FILES (new)

#### `backend/tests/unit/ingestion/sourceReplacement.test.ts`

```typescript
describe('detectSourceReplacement', () => {
  test('returns false when source count >= 70% of canonical')
  test('returns false when source max ID > canonical max ID')
  test('returns false when source count is 0')
  test('returns false when canonical count is 0')
  test('returns true when source < 50% of canonical AND max ID lower AND no overlap')
  test('returns false when there is overlap in IDs')
  test('is idempotent - running twice returns same result')
})

describe('cleanupStaleMyntraData', () => {
  test('deletes normalized_reviews for deleted reviews')
  test('deletes product_dimension for products with no reviews')
  test('deletes product_daily_metrics for deleted review dates')
  test('identifies affected products correctly')
  test('rolls back all changes on any failure')
})
```

**Size:** ~300 lines

---

#### `backend/tests/integration/ingestion/replacementWorkflow.test.ts`

```typescript
describe('Myntra source replacement workflow', () => {
  test('normal incremental update still works')
  test('complete source replacement detected and handled')
  test('partial replacement handled correctly')
  test('replacement cleanup is atomic')
  test('WebSocket events emitted only after commit')
  test('Flipkart data is not affected')
})
```

**Size:** ~400 lines

---

#### `tests/e2e/milestone4-myntra-replacement.js`

Real browser test with:
1. Backup Myntra data
2. Delete and replace source
3. Run ingestion
4. Verify WebSocket event
5. Verify UI updates
6. Restore data

**Size:** ~250 lines

---

## PHASE 2B.5: Complete Replacement Flow Diagram

### Flow When Replacement Detected

```
START trackA('myntra')
  ↓
Get watermark (e.g., 500000)
  ↓
Query: SELECT * FROM myntra_reviews WHERE id > 500000
  ↓
Result: ZERO ROWS (no new data with id > watermark)
  ↓
[NEW] detectSourceReplacement('myntra')
  ├─ source count: 50000
  ├─ source max id: 50000
  ├─ canonical count: 500000
  ├─ canonical max source_row_id: 500000
  ├─ source < 50% canonical? YES
  ├─ source max id < canonical max id? YES
  ├─ overlap check: any id > 50000 in myntra? NO
  └─ RETURN: true (REPLACEMENT DETECTED)
  ↓
[NEW] Re-query with lower bound: id > 0
  └─ Get 50000 new reviews
  ↓
BEGIN TRANSACTION
  ↓
Insert 50000 reviews to normalized_reviews
  ↓
[NEW] cleanupStaleMyntraData(transaction)
  ├─ Find canonical reviews not in source: 450000 rows
  ├─ DELETE from normalized_reviews: 450000 deleted
  ├─ Find products with zero reviews: 400 products
  ├─ DELETE from product_dimension: 400 deleted
  ├─ Find stale metrics: 5000 rows
  ├─ DELETE from product_daily_metrics: 5000 deleted
  └─ Return affected products list (50 products with changes)
  ↓
[NEW] synchronizeProductDimension(50 products, transaction)
  └─ Ensure product_dimension rows current
  ↓
[NEW] synchronizeProductDailyMetrics(50 products, transaction)
  └─ Ensure product_daily_metrics rows current
  ↓
Advance watermark to 50000
  ↓
COMMIT TRANSACTION
  ↓
[EXISTING] For each affected product:
  Emit PRODUCT_DATA_UPDATED event
  ├─ platform: 'myntra'
  ├─ sourceProductId: [each affected product]
  └─ changes: {reviews: true, productDimension: true, dailyMetrics: true}
  ↓
WebSocket broadcasts to all connected clients
  ↓
[EXISTING] Frontend WebSocket clients receive event
  ├─ ProductRankingList: invalidate cache, refetch
  ├─ ProductDetail: invalidate React Query cache, silent refetch
  └─ AI Analyst: [NO ACTION] conversation protected
  ↓
Browser UI updates without page reload
  ↓
DONE
```

### Before/After State

**BEFORE replacement:**
```
myntra_reviews:        500000 rows (old data)
normalized_reviews:    500000 Myntra rows (old)
product_dimension:     1000 Myntra products (old metadata)
product_daily_metrics: 50000 Myntra metrics (old)
watermark:            500000
```

**AFTER replacement and successful ingestion:**
```
myntra_reviews:        50000 rows (new data)
normalized_reviews:    50000 Myntra rows (new)
product_dimension:     50 Myntra products (new metadata)
product_daily_metrics: 500 Myntra metrics (new)
watermark:            50000
```

**Changes:**
- normalized_reviews: 500000 → 50000 (450000 deleted)
- product_dimension: 1000 → 50 (950 deleted)
- product_daily_metrics: 50000 → 500 (49500 deleted)
- watermark: 500000 → 50000

---

## Verification Points

✅ **Detection:** Deterministic, not based on zero rows alone  
✅ **Cleanup:** All old data deleted atomically  
✅ **Transaction:** All-or-nothing semantics  
✅ **Events:** After commit only  
✅ **Platforms:** Myntra only, no Flipkart impact  
✅ **Idempotent:** Safe to retry  

---

## Status: READY FOR IMPLEMENTATION PHASE 2B (Code)

No more verification needed. Ready to write:
1. `sourceReplacement.ts` (new file)
2. Modify `trackA.ts` (existing file)
3. Tests (3 new files)

Then test with real database replacement.

