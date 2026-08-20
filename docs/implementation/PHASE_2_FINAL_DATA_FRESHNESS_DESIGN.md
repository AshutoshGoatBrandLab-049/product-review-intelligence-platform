# PHASE 2 — FINAL DATA FRESHNESS DESIGN

**Date:** 2026-08-20  
**Status:** DESIGN ONLY — NO IMPLEMENTATION  
**Scope:** Complete guaranteed data freshness architecture

---

## EXECUTIVE SUMMARY

**PRIMARY REQUIREMENT RESTATED:**

After a successful ingestion and synchronization cycle, all affected application-derived data is current with respect to the latest data successfully ingested from flipkart_reviews and myntra_reviews.

**FRESHNESS GUARANTEE:**

```
Synchronization is NOT deferred to weekly rebuild.
Synchronization happens DURING the same ingestion cycle.

SOURCE TABLE (flipkart_reviews / myntra_reviews)
    ↓ (TrackA/B)
normalized_reviews ✅ CURRENT
    ↓ (inline synchronization)
product_dimension ✅ CURRENT
product_daily_metrics ✅ CURRENT
    ↓
Rankings / Analytics ✅ CURRENT
```

**Weekly full rebuild remains as SAFETY NET / RECONCILIATION only.**

---

## PART 1: TRANSACTION BOUNDARIES (VERIFIED)

### TrackA Current Implementation

[VERIFIED] — `src/modules/ingestion/trackA.ts:105-113`

```
appSequelize.transaction(async (t) => {
  if (toInsert.length > 0) {
    await NormalizedReview.bulkCreate(toInsert, {
      transaction: t,
      ignoreDuplicates: true,  // ON CONFLICT DO NOTHING
    });
  }
  await advanceLastSeenSourceId(platform, maxIdInBatch, t);
});
```

**GUARANTEE:** Watermark advances if-and-only-if normalized_reviews insert succeeds.

**REQUIRED EXTENSION:** Add product_dimension and product_daily_metrics synchronization INSIDE this transaction.

### TrackB Current Implementation

[VERIFIED] — `src/modules/ingestion/trackB.ts:127-157`

```
const existing = await NormalizedReview.findByPk(canonicalReviewId);

if (!existing) {
  await NormalizedReview.create(buildRow(review, freshHash, mapperVersion(platform)));
  result.rowsInserted += 1;
  continue;  // NO TRANSACTION HERE
}

if (existing.contentHash === freshHash) {
  result.rowsUnchanged += 1;
  continue;
}

await appSequelize.transaction(async (t) => {
  if (looksLikeIdentitySwap(existing, review)) {
    await IdentityAnomaly.create({...}, { transaction: t });
  }
  await existing.update(buildRow(review, freshHash, mapperVersion(platform)), { transaction: t });
});
result.rowsUpdated += 1;
```

**ISSUE:** `NormalizedReview.create()` at line 130 is NOT transactional (discovery of new review during reconciliation window).

**REQUIRED FIX:** Wrap NormalizedReview.create() in same transaction as product_dimension/metrics sync.

---

## PART 2: PRODUCT_DIMENSION SCHEMA (VERIFIED)

[VERIFIED] — `src/database/appStore/models/productDimension.ts`

```
PK: (platform, source_product_id)

Columns (ALL must be synchronized):
  - brand: string | null
  - brandInconsistent: boolean (default: false)
  - productUrl: string | null
  - firstReviewDate: DATE
  - lastReviewDate: DATE
  - totalReviewCount: INTEGER
  - lastRebuiltAt: DATE
```

**DERIVATION RULES [VERIFIED from rebuild.ts:74-112]:**

```
brand:
  ← Latest review_date, tie-break source_row_id DESC

brandInconsistent:
  ← COUNT(DISTINCT brand) FILTER (WHERE brand IS NOT NULL) > 1

productUrl:
  ← From same row as brand (latest review)

firstReviewDate:
  ← MIN(review_date) FROM normalized_reviews

lastReviewDate:
  ← MAX(review_date) FROM normalized_reviews

totalReviewCount:
  ← COUNT(*) FROM normalized_reviews

lastRebuiltAt:
  ← now()
```

---

## PART 3: PRODUCT_DAILY_METRICS SCHEMA (VERIFIED)

[VERIFIED] — `src/database/appStore/models/productDailyMetrics.ts`

```
PK: (platform, source_product_id, review_date)

Columns (ALL must be synchronized):
  - reviewCount: INTEGER
  - ratingSum: INTEGER
  - rating1Count: INTEGER (default: 0)
  - rating2Count: INTEGER (default: 0)
  - rating3Count: INTEGER (default: 0)
  - rating4Count: INTEGER (default: 0)
  - rating5Count: INTEGER (default: 0)
  - positiveCount: INTEGER (default: 0)
  - negativeCount: INTEGER (default: 0)
  - neutralCount: INTEGER (default: 0)
  - helpfulCountSum: INTEGER (default: 0)
  - lastRebuiltAt: DATE
```

**DERIVATION RULES [VERIFIED from rebuild.ts:50-72]:**

```
reviewCount:
  ← COUNT(*)

ratingSum:
  ← SUM(rating)

rating1Count through rating5Count:
  ← COUNT(*) FILTER (WHERE rating = N)

positiveCount:
  ← COUNT(*) FILTER (WHERE rating IN (4,5))

negativeCount:
  ← COUNT(*) FILTER (WHERE rating IN (1,2))

neutralCount:
  ← COUNT(*) FILTER (WHERE rating = 3)

helpfulCountSum:
  ← COALESCE(SUM(helpful_count), 0)

lastRebuiltAt:
  ← now()
```

---

## PART 4: NORMALIZED_REVIEW SOURCE SCHEMA (VERIFIED)

[VERIFIED] — `src/database/appStore/models/normalizedReview.ts`

```
PK: canonicalReviewId

Key Columns for Synchronization:
  - platform: "flipkart" | "myntra"
  - sourceProductId: TEXT
  - rating: SMALLINT
  - reviewDate: DATEONLY
  - brand: TEXT | null
  - helpfulCount: INTEGER | null
  - contentHash: CHAR(64)
  - sourceUpdatedAt: DATE
```

**DERIVATION NOTE:**

canonicalReviewId is deterministic:
```
computeCanonicalReviewId(platform, sourceProductId, sourceReviewId)
```

Grouping keys (platform, sourceProductId, reviewDate) are UNLIKELY to change but MUST be handled.

---

## PART 5: TRACKA SYNCHRONIZATION DESIGN

### New Review Processing Flow

[RECOMMENDED]

```
STEP 1: Read Source (VERIFIED WORKING ✅)
  ├─ WHERE id > last_seen_source_id
  ├─ Batch size configurable
  └─ ORDER BY id

STEP 2: Validate & Map (VERIFIED WORKING ✅)
  ├─ Unified schema validation
  ├─ Reject invalid rows to ingestion_rejects
  └─ Compute canonical_review_id, content_hash

STEP 3: Insert to normalized_reviews (CURRENT TRANSACTION)
  ├─ await NormalizedReview.bulkCreate(
  │    toInsert,
  │    { transaction: t, ignoreDuplicates: true }
  │  )
  └─ Result: ✅ Reviews inserted or skipped if duplicate

STEP 4: Collect Affected Keys (NEW — SAME TRANSACTION)
  ├─ FOR EACH inserted review:
  │  └─ Record: (platform, sourceProductId, reviewDate)
  ├─ Group into unique keys
  └─ Result: Set of affected (platform, sourceProductId, reviewDate)

STEP 5: Synchronize product_dimension (NEW — SAME TRANSACTION)
  ├─ FOR EACH affected (platform, sourceProductId):
  │  └─ INSERT INTO product_dimension (...)
  │     VALUES (...) ON CONFLICT
  │     DO UPDATE SET brand, productUrl, firstReviewDate, lastReviewDate,
  │                   totalReviewCount, brandInconsistent, lastRebuiltAt
  │     WHERE (SELECT COUNT(*), MIN(review_date), MAX(review_date), ...)
  │           FROM normalized_reviews
  └─ Result: ✅ product_dimension reflects new reviews

STEP 6: Synchronize product_daily_metrics (NEW — SAME TRANSACTION)
  ├─ FOR EACH affected (platform, sourceProductId, reviewDate):
  │  └─ INSERT INTO product_daily_metrics (...)
  │     VALUES (...)
  │     ON CONFLICT (platform, sourceProductId, reviewDate)
  │     DO UPDATE SET reviewCount, ratingSum, rating1Count, ...,
  │                   positiveCount, negativeCount, neutralCount,
  │                   helpfulCountSum, lastRebuiltAt
  │     WHERE (SELECT COUNT(*), SUM(rating), ...)
  │           FROM normalized_reviews
  └─ Result: ✅ product_daily_metrics reflects new reviews

STEP 7: Advance Watermark (CURRENT TRANSACTION)
  ├─ await advanceLastSeenSourceId(platform, maxIdInBatch, t)
  └─ Result: ✅ Checkpoint advances

TRANSACTION COMMIT:
  └─ ALL changes committed together, or ALL rolled back on failure
```

**IDEMPOTENCY:** ON CONFLICT DO UPDATE ensures rerun safety.

---

## PART 6: TRACKB SYNCHRONIZATION DESIGN

### Updated Review Processing Flow

[RECOMMENDED]

```
STEP 1: Read Source in Window (VERIFIED WORKING ✅)
  ├─ review_date >= windowStart (70 days lookback)
  ├─ Batch processing
  └─ Window: config.ingestion.reconcileLookbackDays + reconcileSafetyBufferDays

STEP 2: Validate & Map (VERIFIED WORKING ✅)
  ├─ Unified schema validation
  └─ Reject invalid to ingestion_rejects

STEP 3: Check Existing Review
  ├─ existing = await NormalizedReview.findByPk(canonicalReviewId)
  └─ Three branches:

BRANCH A: NOT FOUND in normalized_reviews
  ├─ Review exists in source but not in normalized
  │  (possibly after previous TrackB failure or late arrival within window)
  │
  └─ CREATE TRANSACTION:
     ├─ BEGIN TRANSACTION
     ├─ await NormalizedReview.create(buildRow(...))
     ├─ Collect: (platform, sourceProductId, reviewDate)
     ├─ Synchronize product_dimension (this product)
     ├─ Synchronize product_daily_metrics (this product, date)
     └─ COMMIT

BRANCH B: FOUND, contentHash UNCHANGED
  ├─ No action required
  └─ result.rowsUnchanged += 1

BRANCH C: FOUND, contentHash CHANGED (Review was updated)

[CRITICAL REQUIREMENT — ONE ATOMIC TRANSACTION]

```
BEGIN TRANSACTION

STEP 1: Save BEFORE image
  └─ oldReviewDate = existing.reviewDate
  └─ oldGroupingKey = (platform, sourceProductId, oldReviewDate)

STEP 2: Update normalized_reviews
  ├─ await existing.update(buildRow(...))
  └─ Result: normalized_reviews now has NEW data (updated rating, text, etc.)

STEP 3: Insert identity_anomaly if needed
  └─ await IdentityAnomaly.create({...}, { transaction: t })

STEP 4: Calculate NEW grouping key from updated row
  └─ newGroupingKey = (platform, sourceProductId, normalized_reviews.reviewDate)

STEP 5: Determine affected keys
  ├─ IF oldGroupingKey === newGroupingKey:
  │  └─ affected = [oldGroupingKey]  (review_date unchanged)
  │
  └─ ELSE:
     └─ affected = [oldGroupingKey, newGroupingKey]  (review_date changed)

STEP 6: Synchronize product_dimension
  ├─ synchronizeProductDimension(platform, sourceProductId, transaction: t)
  └─ Deterministic brand recalculated from current normalized_reviews

STEP 7: Synchronize product_daily_metrics
  ├─ FOR EACH affectedGroupingKey in affected:
  │  └─ synchronizeProductDailyMetrics(
  │       platform,
  │       sourceProductId,
  │       reviewDate,
  │       transaction: t
  │     )
  └─ All metrics recalculated from current normalized_reviews

STEP 8: COMMIT TRANSACTION

FAILURE GUARANTEE:
  ├─ IF normalized_reviews.update() fails:
  │  └─ ROLLBACK (identity_anomaly not inserted, derived tables unchanged)
  │
  ├─ IF product_dimension sync fails:
  │  └─ ROLLBACK (normalized_reviews reverted, metrics unchanged)
  │
  ├─ IF product_daily_metrics sync fails:
  │  └─ ROLLBACK (all changes reverted)
  │
  └─ RESULT: NO PARTIAL STATE
     ├─ Either all changes commit together
     └─ Or everything rolls back
```

IDEMPOTENCY:
  ├─ ON CONFLICT DO UPDATE ensures rerun safety
  ├─ Same review processed multiple times → same final state
  └─ No duplicate identity_anomaly records (upsert behavior)

result.rowsUpdated += 1

STEP 4: Record Reconciliation Run
  ├─ await recordReconciliationRun(platform, rowsScanned, rowsChanged)
  └─ Updates watermark metadata

IDEMPOTENCY:
  ├─ ON CONFLICT DO UPDATE ensures upserts are safe
  ├─ Multiple runs with no source changes → zero DB changes
  ├─ Same review processed multiple times → same final state
```

**CRITICAL ISSUE TO VERIFY:** 

When a review's rating changes from 3 → 1, the review_date stays the same (it's a property of the review, not the transaction). So only ONE product_daily_metrics row is affected:

```
OLD: (flipkart, "12345", "2026-08-10")
NEW: (flipkart, "12345", "2026-08-10")  ← SAME

Affected: Only this one row must be recalculated
```

BUT if review_date itself changed (extremely unlikely but possible in data corrections):

```
OLD: (flipkart, "12345", "2026-08-10")
NEW: (flipkart, "12345", "2026-08-11")  ← DIFFERENT

Affected: Both old date and new date rows must be recalculated
```

---

## PART 7: VERY OLD REVIEW HANDLING (CONCRETE MECHANISMS)

[RECOMMENDED]

### Scenario 1: New Source Row with Old review_date

```
SOURCE: flipkart_reviews has new row with review_date = 2025-12-01

TRACKA Processing:
  ├─ Selects WHERE id > last_seen_source_id
  ├─ Finds row with old review_date
  ├─ Inserts to normalized_reviews ✅
  ├─ Detects (platform, sourceProductId, review_date)
  ├─ Synchronizes product_dimension ✅
  ├─ Synchronizes product_daily_metrics for 2025-12-01 ✅
  └─ Result: ✅ CURRENT (not stale for 7 days)
```

**MECHANISM:** TrackA catches all NEW rows regardless of review_date age.

### Scenario 2: Existing Source Row Updated After 70 Days

```
SOURCE: Review with review_date = 2025-12-01, rating = 3
        Source row updated: rating = 1

TRACKB Window: TODAY - 70 days = approximately 2026-06-11 to 2026-08-20
Review's review_date (2025-12-01) is OUTSIDE window.

TRACKB Processing:
  ├─ Queries: WHERE review_date >= windowStart
  ├─ 2025-12-01 < 2026-06-11
  └─ Result: ❌ TrackB MISSES IT

How to correct:
  ├─ Option A: Manual trigger (admin UI to re-scan specific date)
  ├─ Option B: Weekly full rebuild (deterministic recalculation)
  ├─ Option C: Extend lookback window (trade-off: slower TrackB)
  └─ Recommendation: Option B (weekly rebuild catches it)
```

**MECHANISM:** Weekly full rebuild deterministically recalculates product_dimension and product_daily_metrics from normalized_reviews. If source was updated outside TrackB window, rebuild will reflect it.

### Scenario 3: Rating Changed After 70 Days

```
Same as Scenario 2 — rating change is caught by weekly rebuild.
```

### Scenario 4: Product Changed After 70 Days

```
Impossible in normalized schema — product (platform, sourceProductId) is immutable.
Review belongs to one product forever.
```

### Scenario 5: Review Text Changed After 70 Days

```
Same as Scenario 2 — text change caught by weekly rebuild.
Weekly rebuild does NOT depend on contentHash (it's a full recalculation).
```

**SUMMARY:**

```
TrackA: Catches all NEW reviews (regardless of age)
TrackB: Catches CHANGED reviews within 70 days
Weekly: Catches CHANGED reviews outside 70 days (safety net)

No silent stale data. Either caught by A/B or by weekly rebuild.
```

---

## PART 8: IDEMPOTENCY DESIGN

### Upsert Pattern

[RECOMMENDED]

```sql
-- product_dimension upsert (same for all keys)
INSERT INTO product_dimension (platform, source_product_id, brand, ...)
SELECT platform, source_product_id, 
       (deterministic brand selection),
       ...
FROM normalized_reviews
WHERE platform = ? AND source_product_id = ?
GROUP BY platform, source_product_id
ON CONFLICT (platform, source_product_id)
DO UPDATE SET
  brand = EXCLUDED.brand,
  brandInconsistent = EXCLUDED.brandInconsistent,
  productUrl = EXCLUDED.productUrl,
  firstReviewDate = EXCLUDED.firstReviewDate,
  lastReviewDate = EXCLUDED.lastReviewDate,
  totalReviewCount = EXCLUDED.totalReviewCount,
  lastRebuiltAt = EXCLUDED.lastRebuiltAt;
```

**IDEMPOTENT BECAUSE:**
- ✅ SELECT aggregates are deterministic
- ✅ Same input → same output
- ✅ Rerun 10x → same final state
- ✅ ON CONFLICT DO UPDATE is transactional

### Primary Key Constraint

[VERIFIED]

```
product_dimension: (platform, source_product_id)
product_daily_metrics: (platform, source_product_id, review_date)
```

Both PRIMARY KEY constraints support ON CONFLICT (no need to add UNIQUE constraint).

---

## PART 9: FAILURE RECOVERY

### Failure Scenario 1: normalized_reviews INSERT Succeeds, product_dimension FAILS

[RECOMMENDED]

```
TRANSACTION SCOPE:
  ├─ BEGIN
  ├─ INSERT normalized_reviews ✅
  ├─ UPDATE product_dimension ❌ (fails)
  └─ ROLLBACK (entire transaction)

RESULT:
  ├─ normalized_reviews: NOT changed (rolled back)
  ├─ product_dimension: NOT changed
  ├─ Watermark: NOT advanced
  └─ SAFETY: No partial data

RECOVERY:
  ├─ Fix error
  ├─ Rerun ingestion from same watermark
  └─ Deterministic: Same input → same result
```

**GUARANTEE:** No silent partial state. Either all succeeds or all rolls back.

### Failure Scenario 2: normalized_reviews Fails During TrackB CREATE

[REQUIRED]

```
CURRENT CODE (line 130):
  await NormalizedReview.create(buildRow(...))  // No transaction

ISSUE: If CREATE fails, transaction boundary is broken.

REQUIRED FIX:
  Wrap in transaction:
  └─ await appSequelize.transaction(async (t) => {
       await NormalizedReview.create(buildRow(...), { transaction: t });
       await synchronizeProductDimension(platform, sourceProductId, { transaction: t });
       await synchronizeProductDailyMetrics(platform, sourceProductId, reviewDate, { transaction: t });
     });
       
  If any step fails before COMMIT:
  └─ ROLLBACK (normalized_reviews NOT inserted, derived tables unchanged)
```

### Failure Scenario 3: TrackB UPDATE + product_dimension Sync Fails

[REQUIRED — CRITICAL SCENARIO]

```
SCENARIO: Review rating changes 3→1
          TrackB begins atomic transaction
          UPDATE normalized_reviews succeeds ✅
          INSERT identity_anomaly succeeds ✅
          Synchronize product_dimension FAILS ❌

CURRENT BROKEN DESIGN:
  ├─ normalized_reviews already committed (separate transaction)
  ├─ Sync in separate transaction fails
  ├─ Result: normalized_reviews = UPDATED, product_dimension = OLD
  └─ VIOLATION of freshness guarantee ❌

REQUIRED FIX (ONE TRANSACTION):
  ├─ UPDATE normalized_reviews
  ├─ INSERT identity_anomaly
  ├─ TRY: synchronize product_dimension
  ├─ IF FAILS: ROLLBACK (entire transaction)
  ├─ Result: normalized_reviews STILL = 3, product_dimension STILL CONSISTENT ✅
  └─ RETRY: Fix error, rerun ingestion from watermark
```

### Failure Scenario 4: TrackB UPDATE + product_daily_metrics Sync Fails

[REQUIRED — CRITICAL SCENARIO]

```
SCENARIO: Review rating changes 3→1
          Atomic transaction in progress
          normalized_reviews updated ✅
          Synchronize product_dimension succeeded ✅
          Synchronize product_daily_metrics FAILS ❌

REQUIRED BEHAVIOR:
  ├─ ROLLBACK entire transaction
  ├─ Result: normalized_reviews = 3 (rolled back)
  ├─ Result: product_dimension = OLD (rolled back)
  ├─ Result: product_daily_metrics = OLD (never changed)
  └─ GUARANTEE: All three tables consistent ✅
```

### Failure Scenario 5: Process Crashes During TrackB UPDATE Transaction

[REQUIRED]

```
ASSUMPTION A: Crash occurs BEFORE transaction commits.

RECOVERY:
  ├─ PostgreSQL automatically rolls back in-flight transaction
  ├─ Rerun ingestion from same watermark
  ├─ TrackB re-reads source row
  ├─ contentHash still shows as changed
  ├─ Atomic transaction retried
  └─ RESULT: ✅ Consistent state (all three tables match)

ASSUMPTION B: Crash occurs AFTER transaction commits.

RECOVERY:
  ├─ All three tables already committed consistently
  ├─ Rerun ingestion from same watermark (idempotent)
  ├─ ON CONFLICT DO UPDATE produces same values
  └─ RESULT: ✅ Idempotent (database unchanged)
```

### Failure Scenario 6: Ingestion Rerun (Idempotency)

[REQUIRED — STRICT IDEMPOTENCY]

```
IDEMPOTENCY GUARANTEE:
  ├─ Rerun ingestion with no source changes
  ├─ TrackA: ignoreDuplicates skips existing rows
  ├─ TrackB: contentHash matches, zero updates (branch B: no action)
  ├─ Synchronization: ON CONFLICT DO UPDATE with same values
  │
  └─ CRITICAL: lastRebuiltAt behavior
     ├─ Option A: Update lastRebuiltAt ONLY if ANY derived business value changed
     │  └─ Then: Second run produces identical state (strict idempotency)
     │
     ├─ Option B: Always update lastRebuiltAt to now()
     │  └─ Then: Second run produces different timestamp (not idempotent)
     │
     └─ RECOMMENDED: Option A (strict idempotency)
        ├─ For product_dimension, compare ALL:
        │  ├─ brand, brandInconsistent, productUrl
        │  ├─ firstReviewDate, lastReviewDate, totalReviewCount
        │  └─ If ALL identical: do NOT update row, do NOT update lastRebuiltAt
        │
        ├─ For product_daily_metrics, compare ALL:
        │  ├─ reviewCount, ratingSum
        │  ├─ rating1Count, rating2Count, rating3Count, rating4Count, rating5Count
        │  ├─ positiveCount, negativeCount, neutralCount, helpfulCountSum
        │  └─ If ALL identical: do NOT update row, do NOT update lastRebuiltAt
        │
        └─ Result: ✅ Database completely unchanged after first run
                   ✅ No duplicate identity_anomaly records
                   ✅ Timestamp reflects actual last change, not last sync attempt
```

### Failure Scenario 7: Weekly Rebuild as Safety Net

[OPTIONAL — SAFETY NET ONLY]

```
PURPOSE: Weekly rebuild is NOT the primary freshness mechanism.
         It is a safety net that catches edge cases:
         ├─ Bugs in incremental logic
         ├─ Reviews updated outside 70-day TrackB window
         └─ Unknown data anomalies

SCENARIO: Incremental logic had a bug for product P (now fixed).
         Weekly rebuild runs.

WEEKLY REBUILD:
  ├─ TRUNCATE product_dimension
  ├─ TRUNCATE product_daily_metrics
  ├─ Full INSERT from normalized_reviews
  ├─ Same exact SQL as rebuild.ts
  ├─ Deterministic brand selection
  ├─ All columns recalculated
  └─ VALIDATION: SUM(review_count) == COUNT(normalized_reviews)

RESULT:
  ├─ Product P metrics are now CORRECT (regardless of prior bug)
  ├─ All products consistent with normalized_reviews
  └─ ✅ Guaranteed convergence (but should not be necessary)
```

---

## PART 10: TRANSACTION BOUNDARIES (FINAL DESIGN)

[CRITICAL — MUST BE ATOMIC FOR CONSISTENCY]

### TrackA Transaction

```
BEGIN TRANSACTION
  ├─ INSERT INTO normalized_reviews (bulk)
  ├─ Collect affected (platform, sourceProductId, reviewDate)
  ├─ FOR EACH affected product:
  │  └─ INSERT/UPDATE product_dimension
  ├─ FOR EACH affected (product, date):
  │  └─ INSERT/UPDATE product_daily_metrics
  ├─ UPDATE ingestion_watermarks (advance watermark)
  └─ COMMIT (or ROLLBACK on any error)
```

**GUARANTEE:** If normalized_reviews insert succeeds, derived tables are synchronized before commit.

**SIZE:** One transaction per batch (~5,000 reviews) = manageable lock scope.

### TrackB Transaction (Discovery Branch - NEW)

```
BEGIN TRANSACTION
  ├─ INSERT INTO normalized_reviews (newly discovered review)
  ├─ Collect: (platform, sourceProductId, reviewDate)
  ├─ FOR EACH affected product:
  │  └─ INSERT/UPDATE product_dimension
  ├─ FOR EACH affected (product, date):
  │  └─ INSERT/UPDATE product_daily_metrics
  └─ COMMIT (or ROLLBACK on any error)
```

**GUARANTEE:** Discovery is atomic. Either review + derived data all commit, or all rollback.

### TrackB Transaction (Update Branch - ATOMIC, ONE TRANSACTION)

[REQUIRED — CRITICAL CHANGE FROM ORIGINAL DESIGN]

```
BEGIN TRANSACTION
  ├─ STEP 1: Save BEFORE image
  │  └─ oldReviewDate = existing.reviewDate
  │  └─ oldGroupingKey = (platform, sourceProductId, oldReviewDate)
  │
  ├─ STEP 2: Update normalized_reviews
  │  └─ await existing.update(buildRow(...), { transaction: t })
  │
  ├─ STEP 3: Insert identity_anomaly if needed
  │  └─ await IdentityAnomaly.create({...}, { transaction: t })
  │
  ├─ STEP 4: Calculate NEW grouping key
  │  └─ newGroupingKey = (platform, sourceProductId, normalized_reviews.reviewDate)
  │
  ├─ STEP 5: Determine affected keys
  │  ├─ IF oldGroupingKey === newGroupingKey:
  │  │  └─ affected = [oldGroupingKey]
  │  │
  │  └─ ELSE:
  │     └─ affected = [oldGroupingKey, newGroupingKey]
  │
  ├─ STEP 6: Synchronize product_dimension
  │  └─ synchronizeProductDimension(platform, sourceProductId, { transaction: t })
  │
  ├─ STEP 7: Synchronize product_daily_metrics for ALL affected keys
  │  └─ FOR EACH (platform, sourceProductId, reviewDate) in affected:
  │     └─ synchronizeProductDailyMetrics(platform, sourceProductId, reviewDate, { transaction: t })
  │
  └─ COMMIT (or ROLLBACK on any error)
```

**CRITICAL GUARANTEE:**

```
NO INTERMEDIATE STATE ALLOWED:

❌ NOT THIS:
   ├─ normalized_reviews UPDATED (committed)
   ├─ product_dimension FAILS (not rolled back)
   └─ Result: INCONSISTENT ❌

✅ THIS ONLY:
   ├─ All changes in one transaction
   ├─ All commit together
   ├─ All roll back together on any error
   └─ Result: ALWAYS CONSISTENT ✅
```

**ATOMICITY ENFORCED:** If product_dimension or product_daily_metrics sync fails, normalized_reviews update is also rolled back.

---

## PART 11: PERFORMANCE OPTIMIZATION

[RECOMMENDED]

### Batch Synchronization

```
DON'T do this:
  FOR review in batch:
    synchronize_product_dimension(review.sourceProductId)
    synchronize_metrics(review.platform, review.sourceProductId, review.reviewDate)

REASON: O(n) database calls, redundant recalculations for same product

DO do this:
  affected_products = SET()
  affected_metrics = SET()
  FOR review in batch:
    affected_products.add((review.platform, review.sourceProductId))
    affected_metrics.add((review.platform, review.sourceProductId, review.reviewDate))
  
  FOR (platform, sourceProductId) in affected_products:
    synchronize_product_dimension(platform, sourceProductId)
  
  FOR (platform, sourceProductId, reviewDate) in affected_metrics:
    synchronize_metrics(platform, sourceProductId, reviewDate)

RESULT: O(unique_products) + O(unique_dates) calls (much smaller)
```

**TYPICAL BATCH:** 5,000 reviews, ~100 unique products, ~100 unique dates.

---

## PART 12: CONCURRENCY HANDLING

[VERIFIED - PostgreSQL MVCC]

### Rankings Query During Synchronization

[VERIFIED - PostgreSQL MVCC / Transaction Isolation]

```
SCENARIO: Rankings query reads product_daily_metrics while sync writes.

PostgreSQL MVCC / Transaction Isolation:
  ├─ Rankings query starts transaction, reads committed snapshot (point-in-time)
  ├─ Sync writes to product_daily_metrics (different rows in progress)
  ├─ Rankings query sees ONLY committed rows from its snapshot (not in-progress writes)
  ├─ Sync COMMITS all changes atomically
  ├─ Next Rankings query (new transaction) sees post-sync committed snapshot
  └─ NO locking conflicts, NO dirty reads, NO inconsistent reads within transaction

TRANSACTIONAL CONSISTENCY GUARANTEE:
  ├─ Existing readers: see consistent committed snapshot (may be pre-sync)
  ├─ In-progress writes: ALWAYS atomic (commit or rollback, never partial)
  ├─ New readers: after commit, see new committed snapshot
  └─ Result: TRANSACTIONAL CONSISTENCY, not eventual consistency
     ├─ No intermediate state visible to any reader
     ├─ All readers always see a consistent point-in-time view
     └─ Once sync commits, next reads see current data immediately
```

### No Exclusive Locks

[RECOMMENDED]

```
DON'T:
  LOCK TABLE product_dimension IN EXCLUSIVE MODE

DO:
  ON CONFLICT DO UPDATE (row-level locks only)

RESULT: ✅ High concurrency, no table locks
```

---

## PART 13: WEEKLY FULL REBUILD (SAFETY NET)

[VERIFIED EXISTING]

```
Schedule: Sunday 2 AM UTC (configurable)
Run independently of daily ingestion (separate advisory lock if needed)

STEP 1: Full Rebuild
  ├─ TRUNCATE product_dimension
  ├─ TRUNCATE product_daily_metrics
  ├─ INSERT all computed values from normalized_reviews
  ├─ Deterministic brand selection (same as incremental)
  └─ All columns computed exactly as incremental

STEP 2: Validation
  ├─ SUM(product_daily_metrics.review_count) == COUNT(normalized_reviews)
  ├─ If validation fails: ROLLBACK (roll back entire rebuild)
  └─ If validation passes: COMMIT

STEP 3: Logging
  ├─ Log rebuild start/end times
  ├─ Log row counts
  ├─ Log validation result
  └─ Alert on failures

PURPOSE:
  ├─ Catch any reviews changed outside 70-day TrackB window
  ├─ Catch any synchronization bugs from incremental approach
  ├─ Verify consistency: metrics sum == normalized count
  └─ Recovery: If incremental failed silently, rebuild fixes it
```

**CONCURRENCY WITH INGESTION:**
- Use existing advisory lock mechanism (already in watermarkRepo.ts)
- Prevent rebuild from running during ingestion
- Schedule rebuild for off-peak hours

---

## PART 14: AI ANALYST (UNCHANGED)

[VERIFIED - ALREADY WORKING ✅]

```
NO CHANGES REQUIRED

Requirement: ✅ ALREADY MET
  ├─ Queries normalized_reviews directly
  ├─ No caching
  ├─ Fresh response on every question
  └─ Bypasses product_dimension/product_daily_metrics

Implication:
  ├─ AI Analyst always shows current state
  ├─ Rankings shows current state (via synchronized product_daily_metrics)
  └─ Data consistency guaranteed
```

---

## PART 15: SENTIMENT / THEME (PHASE 4+, UNCHANGED)

[DESIGN UNCHANGED]

```
NO CHANGES to Phase 3

Responsibility: Phase 4+ (not this phase)
  ├─ review_sentiment: Intentionally empty in Phase 3
  ├─ review_theme: Intentionally empty in Phase 3
  └─ Kept as foundation tables for Phase 4

Phase 4 Trigger (when implemented):
  ├─ After normalized_reviews updated
  ├─ Trigger sentiment/theme extraction
  └─ Content hash prevents reprocessing of same version
```

---

## PART 16: DATABASE CHANGES REQUIRED

[VERIFIED]

```
NO BREAKING CHANGES to existing schema.

Existing PKs support ON CONFLICT:
  ├─ product_dimension (platform, source_product_id)
  ├─ product_daily_metrics (platform, source_product_id, review_date)
  └─ Both support ON CONFLICT DO UPDATE

Optional Performance Indexes (if not already present):
  └─ None critical for correctness, all for performance

Verification needed during implementation:
  └─ Check if indexes already exist
  └─ Add only if missing
```

---

## PART 17: FILES TO MODIFY

### 1. backend/src/modules/ingestion/trackA.ts

[RECOMMENDED]

```
CHANGES:
  ├─ Line 105-113: After bulkCreate and before advanceLastSeenSourceId
  │  ├─ Collect affected (platform, sourceProductId) from inserted rows
  │  ├─ Collect affected (platform, sourceProductId, reviewDate) from inserted rows
  │  ├─ Group into unique keys
  │  └─ Continue below
  │
  ├─ NEW FUNCTION CALLS (before advanceLastSeenSourceId):
  │  ├─ synchronizeProductDimensions(platform, affectedProducts)
  │  ├─ synchronizeProductDailyMetrics(platform, affectedMetricsKeys)
  │  └─ All inside same transaction (t)
  │
  └─ If any sync fails, transaction rolls back (no partial state)
```

### 2. backend/src/modules/ingestion/trackB.ts

[RECOMMENDED]

```
CHANGES:
  ├─ Line 130 (NEW DISCOVERY BRANCH):
  │  ├─ Wrap NormalizedReview.create() in transaction
  │  ├─ Add synchronizeProductDimensions() inside transaction
  │  ├─ Add synchronizeProductDailyMetrics() inside transaction
  │
  └─ Line 140-155 (EXISTING UPDATE BRANCH — ATOMIC, CRITICAL):
     ├─ BEGIN TRANSACTION (single, atomic)
     │  ├─ STEP 1: Save BEFORE image
     │  │  └─ oldReviewDate = existing.reviewDate
     │  │  └─ oldGroupingKey = (platform, sourceProductId, oldReviewDate)
     │  │
     │  ├─ STEP 2: Update normalized_reviews
     │  │  └─ await existing.update(buildRow(...), { transaction: t })
     │  │
     │  ├─ STEP 3: Insert identity_anomaly if needed
     │  │  └─ await IdentityAnomaly.create({...}, { transaction: t })
     │  │
     │  ├─ STEP 4: Calculate NEW grouping key
     │  │  └─ newGroupingKey = (platform, sourceProductId, existing.reviewDate)
     │  │
     │  ├─ STEP 5: Determine affected keys
     │  │  ├─ IF oldGroupingKey === newGroupingKey:
     │  │  │  └─ affected = [oldGroupingKey]
     │  │  └─ ELSE:
     │  │     └─ affected = [oldGroupingKey, newGroupingKey]
     │  │
     │  ├─ STEP 6: Synchronize product_dimension
     │  │  └─ synchronizeProductDimension(platform, sourceProductId, { transaction: t })
     │  │
     │  ├─ STEP 7: Synchronize product_daily_metrics for ALL affected keys
     │  │  └─ FOR EACH (platform, sourceProductId, reviewDate) in affected:
     │  │     └─ synchronizeProductDailyMetrics(platform, sourceProductId, reviewDate, { transaction: t })
     │  │
     │  └─ COMMIT (or ROLLBACK on any error)
     │
     ├─ CRITICAL: If product_dimension sync fails → ROLLBACK normalized_reviews
     ├─ CRITICAL: If product_daily_metrics sync fails → ROLLBACK ALL changes
     └─ GUARANTEE: NO intermediate state (all consistent or all rolled back)
```

### 3. backend/src/database/queries/productDimensionSync.ts (NEW FILE)

[RECOMMENDED]

```
FUNCTION: synchronizeProductDimension(
  platform: Platform,
  sourceProductId: string,
  transaction?: Transaction
): Promise<void>

IMPLEMENTATION:
  ├─ Query normalized_reviews for this product
  ├─ Calculate all fields (brand, firstReviewDate, lastReviewDate, count, inconsistent, url)
  ├─ INSERT / ON CONFLICT DO UPDATE
  └─ Deterministic brand selection (latest review_date, tie-break source_row_id DESC)

DETERMINISTIC BRAND LOGIC [from rebuild.ts:74-86]:
  └─ WITH ranked AS (
       SELECT platform, source_product_id, brand, product_url,
              row_number() OVER (
                PARTITION BY platform, source_product_id
                ORDER BY review_date DESC, source_row_id DESC
              ) AS rn
       FROM normalized_reviews
     )
     SELECT brand, product_url FROM ranked WHERE rn = 1
```

### 4. backend/src/database/queries/productDailyMetricsSync.ts (NEW FILE)

[REQUIRED — DELETE IF ZERO REVIEWS]

```
FUNCTION: synchronizeProductDailyMetrics(
  platform: Platform,
  sourceProductId: string,
  reviewDate: string,
  transaction?: Transaction
): Promise<void>

IMPLEMENTATION:

STEP 1: Query normalized_reviews for (platform, sourceProductId, reviewDate)
  └─ SELECT COUNT(*) to check if any reviews exist for this key

STEP 2: BRANCH on result
  │
  ├─ IF COUNT(*) = 0 (no reviews for this key):
  │  └─ DELETE FROM product_daily_metrics
  │     WHERE platform = ? AND source_product_id = ? AND review_date = ?
  │     (inside transaction: t)
  │  └─ Purpose: Remove stale rows when all reviews deleted or moved to different date
  │  └─ Result: No orphaned zero-count rows remain
  │
  └─ IF COUNT(*) > 0 (reviews exist):
     ├─ Calculate all aggregate columns from normalized_reviews
     ├─ INSERT INTO product_daily_metrics (...)
     ├─ ON CONFLICT (platform, source_product_id, review_date)
     ├─ DO UPDATE SET (all columns updated)
     └─ All columns updated (no partial updates)

AGGREGATION LOGIC [from rebuild.ts:50-72]:
  └─ SELECT
       count(*) AS review_count,
       sum(rating) AS rating_sum,
       count(*) FILTER (WHERE rating = 1) AS rating_1_count,
       count(*) FILTER (WHERE rating = 2) AS rating_2_count,
       count(*) FILTER (WHERE rating = 3) AS rating_3_count,
       count(*) FILTER (WHERE rating = 4) AS rating_4_count,
       count(*) FILTER (WHERE rating = 5) AS rating_5_count,
       count(*) FILTER (WHERE rating IN (4,5)) AS positive_count,
       count(*) FILTER (WHERE rating IN (1,2)) AS negative_count,
       count(*) FILTER (WHERE rating = 3) AS neutral_count,
       coalesce(sum(helpful_count), 0) AS helpful_count_sum
     FROM normalized_reviews
     WHERE platform = ? AND source_product_id = ? AND review_date = ?

IDEMPOTENCY:
  ├─ DELETE is idempotent (second delete finds zero rows, no error)
  ├─ UPSERT is idempotent (second insert gets same aggregates)
  └─ Rerun multiple times = same final state
```

### 5. backend/src/modules/analytics/rebuild.ts

[RECOMMENDED]

```
CHANGES:
  ├─ Keep existing rebuildAnalytics() function as-is
  ├─ Add scheduling trigger (placeholder for weekly runner)
  ├─ Document: "Weekly safety net / reconciliation"
  └─ NO changes to SQL logic (it's correct)
```

### 6. tests/modules/ingestion/trackA.test.ts

[RECOMMENDED - Update existing]

```
CHANGES:
  ├─ Add test: New review → product_dimension created
  ├─ Add test: New review → product_daily_metrics created
  ├─ Add test: Multiple reviews same product, date → metrics aggregated
  ├─ Add test: Rerun with same data → idempotent (no changes)
  └─ Verify all defined test scenarios below
```

### 7. tests/modules/ingestion/trackB.test.ts

[RECOMMENDED - Update existing]

```
CHANGES:
  ├─ Add test: Rating 3→1 → product_daily_metrics updated
  ├─ Add test: Brand changed → product_dimension brand updated
  ├─ Add test: Review text changed → product_daily_metrics unchanged (rating same)
  ├─ Add test: Helpful count changed → product_daily_metrics.helpfulCountSum updated
  ├─ Add test: Old review outside 70-day window → TrackB misses (verify window behavior)
  └─ Add test: Discovered review in window → synchronized
```

### 8. CI/CD Configuration (External)

[RECOMMENDED]

```
NO CODE CHANGES, but external configuration:

Daily Job:
  ├─ Trigger: 1:00 AM UTC
  ├─ Command: backend/src/modules/ingestion/runIngestion.ts
  │  ├─ runIngestion("flipkart")
  │  ├─ runIngestion("myntra")
  │  └─ Both calls sequential
  └─ Timeout: 30 minutes (configurable)

Weekly Job:
  ├─ Trigger: Sunday 2:00 AM UTC
  ├─ Command: backend/src/modules/analytics/rebuild.ts
  │  └─ rebuildAnalytics()
  └─ Timeout: 60 minutes (configurable)

Monitoring:
  ├─ Log ingestion success/failure
  ├─ Alert on failures
  ├─ Dashboard: last-run timestamps
  └─ Dashboard: row counts (verification)
```

---

## PART 18: TEST PLAN (COMPREHENSIVE)

[RECOMMENDED]

Test ALL scenarios before declaring Phase 3.2 complete.

### Test 1: New Flipkart Review

```
STEP 1: Insert source row in flipkart_reviews
        ├─ rating: 4
        ├─ brand: "BrandX"
        ├─ review_date: today
        └─ product_id: "P1"

STEP 2: Run ingestion
        └─ runIngestion("flipkart")

STEP 3: Verify normalized_reviews
        └─ SELECT COUNT(*) = 1 WHERE sourceProductId = "P1"

STEP 4: Verify product_dimension
        ├─ Exists: (flipkart, P1)
        ├─ brand = "BrandX"
        ├─ totalReviewCount = 1
        ├─ firstReviewDate = today
        ├─ lastReviewDate = today
        └─ brandInconsistent = false

STEP 5: Verify product_daily_metrics
        ├─ Exists: (flipkart, P1, today)
        ├─ reviewCount = 1
        ├─ ratingSum = 4
        ├─ rating4Count = 1
        ├─ rating1Count through rating3Count, rating5Count = 0
        ├─ positiveCount = 1
        ├─ negativeCount = 0
        ├─ neutralCount = 0
        └─ helpfulCountSum = 0

STATUS: ✅ PASS if all verify ✅
```

### Test 2: New Myntra Review

```
(Same as Test 1, but platform = "myntra")
```

### Test 3: New Product

```
STEP 1: Insert source row for new product "P_NEW"
        ├─ Product has never appeared before
        ├─ Insert one review

STEP 2: Run ingestion

STEP 3: Verify product_dimension row created
        ├─ Exists: (flipkart, P_NEW)
        └─ All fields populated

STEP 4: Rankings API query
        ├─ SELECT FROM product_dimension WHERE ...
        ├─ Product P_NEW should appear
        └─ Verify visible without needing manual rebuild

STATUS: ✅ PASS if P_NEW is visible
```

### Test 4: Existing Product + New Review

```
STEP 1: Product P1 already exists in DB
        ├─ totalReviewCount = 5
        ├─ lastReviewDate = "2026-08-10"

STEP 2: Insert new source row for P1
        ├─ review_date = "2026-08-20"
        ├─ rating = 5

STEP 3: Run ingestion

STEP 4: Verify product_dimension updated
        ├─ totalReviewCount = 6 (was 5)
        ├─ lastReviewDate = "2026-08-20" (was 2026-08-10)
        └─ firstReviewDate unchanged

STEP 5: Verify product_daily_metrics
        ├─ New row created for (P1, 2026-08-20)
        ├─ reviewCount = 1
        ├─ rating5Count = 1

STATUS: ✅ PASS if counts match
```

### Test 5: Rating 3 → 1

```
STEP 1: Existing review has rating = 3
        ├─ (flipkart, P1, 2026-08-15)
        ├─ Current product_daily_metrics.rating3Count = 1

STEP 2: Source row updated: rating = 1

STEP 3: Run ingestion (TrackB detects change)

STEP 4: Verify normalized_reviews updated
        └─ rating = 1

STEP 5: Verify product_daily_metrics recalculated
        ├─ rating3Count = 0 (was 1, rating 3 is neutral)
        ├─ rating1Count = 1 (was 0, rating 1 is negative)
        ├─ positiveCount = UNCHANGED (rating 3 was not positive, rating 1 is not positive)
        ├─ negativeCount = +1 (added one negative rating)
        ├─ neutralCount = -1 (removed one neutral rating)
        └─ All sums recalculated

STEP 6: Direct calculation verification
        ├─ SELECT COUNT(*) FILTER (WHERE rating=3) FROM normalized_reviews
        ├─ SELECT COUNT(*) FILTER (WHERE rating=1) FROM normalized_reviews
        ├─ Compare with product_daily_metrics
        └─ Must match exactly

STATUS: ✅ PASS if metrics match direct calculation
```

### Test 6: Rating 1 → 5

```
(Same as Test 5, different rating direction)
```

### Test 7: Review Text Updated (Same Rating)

```
STEP 1: Existing review, rating = 4, text = "good"

STEP 2: Source row updated: text = "excellent" (rating unchanged)

STEP 3: Run ingestion (TrackB detects change)

STEP 4: Verify normalized_reviews.reviewText updated

STEP 5: Verify product_daily_metrics UNCHANGED
        ├─ rating4Count stays same
        ├─ positiveCount stays same
        ├─ All counts stay same
        └─ Only lastRebuiltAt may update

STATUS: ✅ PASS if metrics unchanged (correct behavior)
```

### Test 8: Helpful Count Updated

```
STEP 1: Review has helpfulCount = 5

STEP 2: Source updated: helpfulCount = 10

STEP 3: Run ingestion

STEP 4: Verify product_daily_metrics.helpfulCountSum updated
        └─ +5 (if only one review changed)

STATUS: ✅ PASS if helpfulCountSum correct
```

### Test 9: Multiple Reviews Same Date

```
STEP 1: Insert 3 reviews for (P1, today)
        ├─ ratings: 4, 5, 3

STEP 2: Run ingestion

STEP 3: Verify product_daily_metrics
        ├─ ONE row for (P1, today)
        ├─ reviewCount = 3
        ├─ ratingSum = 12
        ├─ rating3Count = 1
        ├─ rating4Count = 1
        ├─ rating5Count = 1
        └─ positiveCount = 2

STATUS: ✅ PASS if aggregation correct
```

### Test 10: Old Review Arriving Late (Within 70 Days)

```
STEP 1: Source has new review with review_date = 70 days ago

STEP 2: Run ingestion (TrackA processes)

STEP 3: Verify normalized_reviews has it

STEP 4: Verify product_daily_metrics created for old date

STEP 5: Run Rankings query
        └─ Should include metrics for old date

STATUS: ✅ PASS if old-date metrics are current
```

### Test 11: Very Old Review Arriving (>70 Days)

```
STEP 1: Source has new review with review_date = 200 days ago

STEP 2: Run ingestion (TrackA processes)

STEP 3: Verify normalized_reviews has it
        └─ TrackA ignores date window (catches all new rows)

STEP 4: Verify product_daily_metrics created for old date
        └─ Even though TrackB wouldn't find it, TrackA does

STEP 5: Next weekly rebuild
        └─ Also confirms correctness

STATUS: ✅ PASS if very old metrics are correct
```

### Test 12: Rerun Ingestion (Idempotency)

```
STEP 1: Insert 10 reviews and run ingestion

STEP 2: Record state:
        ├─ normalized_reviews count = X
        ├─ product_dimension row values
        └─ product_daily_metrics row values

STEP 3: Rerun same ingestion (no source changes)

STEP 4: Verify state unchanged
        ├─ normalized_reviews count = X (unchanged)
        ├─ product_dimension rows identical
        ├─ product_daily_metrics rows identical
        └─ No duplicate inserts, no inconsistent updates

STATUS: ✅ PASS if state completely unchanged
```

### Test 13: Rerun Synchronization (Idempotency)

```
STEP 1: Manually call synchronization functions directly
        ├─ synchronizeProductDimension("flipkart", "P1")
        ├─ synchronizeProductDailyMetrics("flipkart", "P1", "2026-08-20")

STEP 2: Record state

STEP 3: Call same functions again with same parameters

STEP 4: Verify state unchanged
        └─ Same values, same row counts

STATUS: ✅ PASS if synchronization is idempotent
```

### Test 14: Simulated Downstream Sync Failure

```
STEP 1: Mock synchronizeProductDimension to throw error

STEP 2: Run ingestion

STEP 3: Verify transaction rolled back
        ├─ normalized_reviews NOT inserted
        ├─ watermark NOT advanced
        └─ product_dimension NOT modified

STEP 4: Fix error

STEP 5: Rerun ingestion

STEP 6: Verify success
        ├─ normalized_reviews inserted
        ├─ synchronization succeeds
        └─ watermark advanced

STATUS: ✅ PASS if failure is recovered without stale data
```

### Test 15: TrackB Updated Review + Downstream Failure (CRITICAL)

[MANDATORY — PROVES ATOMIC CONSISTENCY]

```
STEP 1: Setup existing review
        ├─ canonicalReviewId: "abc123"
        ├─ platform: "flipkart"
        ├─ sourceProductId: "P1"
        ├─ rating: 3
        ├─ reviewDate: "2026-08-15"

STEP 2: Verify current product_daily_metrics
        ├─ (flipkart, P1, 2026-08-15)
        ├─ rating3Count: 1
        ├─ rating1Count: 0
        └─ reviewCount: 1 (example)

STEP 3: Update source
        └─ Set rating: 3 → 1

STEP 4: Mock synchronizeProductDailyMetrics to FAIL
        ├─ Force error during sync
        └─ Do NOT persist any changes

STEP 5: Run ingestion (TrackB processes updated review)

STEP 6: Verify TrackB failed (no success logged)

STEP 7: Verify normalized_reviews UNCHANGED
        ├─ SELECT rating FROM normalized_reviews WHERE canonical_review_id = 'abc123'
        ├─ Result: 3 (NOT 1)
        └─ Proof: Update was rolled back ✅

STEP 8: Verify product_daily_metrics UNCHANGED
        ├─ SELECT rating3Count, rating1Count FROM product_daily_metrics
        ├─ rating3Count: 1 (unchanged)
        ├─ rating1Count: 0 (unchanged)
        └─ Proof: Sync rollback was effective ✅

STEP 9: Verify product_dimension UNCHANGED
        ├─ Check lastReviewDate, brand, etc.
        └─ All values same as STEP 1 state ✅

STEP 10: Fix the sync failure (unmock)

STEP 11: Rerun ingestion

STEP 12: Verify success this time

STEP 13: Verify normalized_reviews now UPDATED
        ├─ SELECT rating FROM normalized_reviews WHERE canonical_review_id = 'abc123'
        ├─ Result: 1 ✅

STEP 14: Verify product_daily_metrics now UPDATED
        ├─ SELECT rating3Count, rating1Count FROM product_daily_metrics
        ├─ rating3Count: 0 ✅
        ├─ rating1Count: 1 ✅
        └─ Proof: Sync succeeded ✅

STEP 15: Verify product_dimension updated
        ├─ Deterministic brand recalculated
        └─ All fields current ✅

STATUS: ✅ MANDATORY PASS
        This test proves:
        ├─ Failure rolls back normalized_reviews (not just sync)
        ├─ No intermediate state where normalized is new and derived is old
        ├─ Rerun is safe and idempotent
        └─ Atomic transaction works correctly
```

### Test 16: Process Crash/Restart

```
STEP 1: Start ingestion, stop process at random point during TrackB UPDATE

STEP 2: Restart ingestion from beginning

STEP 3: Verify final state is correct
        ├─ No duplicate rows
        ├─ All metrics consistent
        ├─ Watermark advanced properly
        └─ Idempotent recovery works

STATUS: ✅ PASS if restart produces correct state
```

### Test 17: Weekly Full Rebuild Correctness

```
STEP 1: Ingestion with incremental sync completes

STEP 2: Record product_dimension and product_daily_metrics state

STEP 3: Run weekly full rebuild

STEP 4: Verify post-rebuild state matches pre-rebuild state
        ├─ Same row counts
        ├─ Same values
        ├─ Same last_rebuilt_at (or very close)

STEP 5: Validation check passes
        └─ SUM(review_count) == COUNT(normalized_reviews)

STATUS: ✅ PASS if rebuild produces identical results
```

### Test 18: Rankings Reflects Latest Data

```
STEP 1: Insert new reviews for P1 (rating 5)

STEP 2: Run ingestion + sync

STEP 3: Query Rankings API for P1

STEP 4: Verify returned metrics reflect new reviews
        ├─ averageRating increased
        ├─ totalReviewCount increased
        └─ Query uses product_daily_metrics

STEP 5: Change rating in source (5 → 1)

STEP 6: Rerun ingestion

STEP 7: Query Rankings again

STEP 8: Verify metrics updated
        └─ averageRating decreased

STATUS: ✅ PASS if Rankings always shows current data
```

### Test 19: AI Analyst Reflects Latest Data

```
STEP 1: Insert reviews for P1

STEP 2: Query AI Analyst: "What is average rating?"

STEP 3: Verify response matches current normalized_reviews

STEP 4: Change rating in source

STEP 5: Rerun ingestion

STEP 6: Query AI Analyst again (same question)

STEP 7: Verify response updated (different from before)
        └─ No caching of question-response

STATUS: ✅ PASS if AI Analyst always fresh
```

### Test 20: No Duplicate Rows

```
STEP 1: Run ingestion multiple times

STEP 2: Check for duplicate rows
        ├─ SELECT COUNT(*) FROM product_dimension WHERE (platform, source_product_id) NOT DISTINCT
        ├─ SELECT COUNT(*) FROM product_daily_metrics WHERE (platform, source_product_id, review_date) NOT DISTINCT
        └─ Should return 0

STATUS: ✅ PASS if no duplicates exist
```

### Test 21: product_dimension Matches normalized_reviews

```
STEP 1: Calculate ground truth from normalized_reviews:
        ├─ FOR EACH (platform, sourceProductId):
        │  ├─ brand = latest review (deterministic)
        │  ├─ firstReviewDate = MIN(review_date)
        │  ├─ lastReviewDate = MAX(review_date)
        │  ├─ totalReviewCount = COUNT(*)
        │  ├─ brandInconsistent = (COUNT(DISTINCT brand) > 1)
        │  └─ Store in temp table

STEP 2: Compare with product_dimension
        ├─ SELECT COUNT(*) WHERE product_dimension DIFFERS FROM ground_truth
        └─ Should be 0

STEP 3: product_daily_metrics Matches normalized_reviews
        ├─ FOR EACH (platform, sourceProductId, reviewDate):
        │  ├─ reviewCount = COUNT(*)
        │  ├─ ratingSum = SUM(rating)
        │  ├─ rating1Count through rating5Count (all 5)
        │  ├─ positiveCount = COUNT(*) FILTER (WHERE rating IN (4,5))
        │  ├─ negativeCount = COUNT(*) FILTER (WHERE rating IN (1,2))
        │  ├─ neutralCount = COUNT(*) FILTER (WHERE rating = 3)
        │  ├─ helpfulCountSum = COALESCE(SUM(helpful_count), 0)
        │  └─ Store in temp table

STEP 4: Compare with product_daily_metrics
        ├─ SELECT COUNT(*) WHERE product_daily_metrics DIFFERS FROM ground_truth
        └─ Should be 0

STATUS: ✅ PASS if all metrics match independent calculation
```

---

## PART 19: ROLLBACK PLAN

### Rollback from Incremental to Full Rebuild Only

[REQUIRED — DEGRADATION STATEMENT]

```
IF incremental approach causes critical issues:

STEP 1: Disable incremental sync calls (feature flag or code change)
        ├─ Comment out synchronizeProductDimension() calls
        ├─ Comment out synchronizeProductDailyMetrics() calls
        └─ Revert code to ingestion-only

STEP 2: Keep weekly full rebuild enabled
        ├─ Rebuild runs every Sunday
        ├─ Provides DELAYED freshness (within 7 days, not immediate)
        └─ Application continues with degraded freshness SLA

STEP 3: Redeploy

CRITICAL STATEMENT:
        ├─ This rollback DOES NOT satisfy immediate freshness requirement
        ├─ Weekly rebuild is a SAFETY NET, not primary freshness mechanism
        ├─ System is in DEGRADED FRESHNESS MODE
        ├─ Data may be stale for up to 7 days until next rebuild
        └─ DO NOT represent this as meeting original freshness guarantee

TIME TO ROLLBACK: ~10 minutes
DATA RISK: NONE (incremental code path is disabled)
CUSTOMER IMPACT: DEGRADED (7-day freshness guarantee, not immediate)

RECOVERY:
        ├─ Identify root cause of incremental failure
        ├─ Fix incremental synchronization code
        ├─ Re-enable incremental sync calls
        ├─ Redeploy with ATOMIC transaction fix
        └─ System returns to IMMEDIATE freshness guarantee
```

### Rollback from Scheduled Ingestion to Manual

```
IF scheduler has issues:

STEP 1: Disable scheduled ingestion
STEP 2: Ingestion still callable manually
STEP 3: Application continues (just needs manual triggers)

TIME TO ROLLBACK: Minutes
DATA RISK: NONE
```

---

## PART 20: FINAL ARCHITECTURE DIAGRAM

```
DAILY SOURCE UPDATES (External)
│
├─ DataWarehouse.flipkart_reviews
└─ DataWarehouse.myntra_reviews

        ↓
        
INGESTION CYCLE (Phase 3 — SYNCHRONOUS)
│
├─ TrackA: New reviews
│  └─ WHERE id > lastSeenSourceId
│     ├─ Validate & map
│     ├─ INSERT normalized_reviews (this transaction)
│     ├─ Collect affected keys
│     ├─ synchronizeProductDimension() (this transaction)
│     ├─ synchronizeProductDailyMetrics() (this transaction)
│     ├─ UPDATE watermarks (this transaction)
│     └─ COMMIT or ROLLBACK
│
├─ TrackB: Updated reviews
│  └─ WHERE review_date >= windowStart
│     ├─ IF NEW in normalized (discovered):
│     │  ├─ BEGIN TRANSACTION
│     │  ├─ INSERT normalized_reviews
│     │  ├─ synchronizeProductDimension()
│     │  ├─ synchronizeProductDailyMetrics()
│     │  └─ COMMIT (or ROLLBACK)
│     │
│     ├─ ELIF CONTENT CHANGED (ATOMIC TRANSACTION):
│     │  ├─ BEGIN TRANSACTION
│     │  │  ├─ STEP 1: Save BEFORE image
│     │  │  │  └─ oldGroupingKey = (platform, sourceProductId, oldReviewDate)
│     │  │  │
│     │  │  ├─ STEP 2: UPDATE normalized_reviews
│     │  │  │  └─ await existing.update(buildRow(...), { transaction: t })
│     │  │  │
│     │  │  ├─ STEP 3: INSERT identity_anomaly if needed
│     │  │  │  └─ await IdentityAnomaly.create({...}, { transaction: t })
│     │  │  │
│     │  │  ├─ STEP 4: Calculate NEW grouping key
│     │  │  │  └─ newGroupingKey = (platform, sourceProductId, updatedReviewDate)
│     │  │  │
│     │  │  ├─ STEP 5: Determine affected keys
│     │  │  │  ├─ IF oldGroupingKey === newGroupingKey:
│     │  │  │  │  └─ affected = [oldGroupingKey]
│     │  │  │  └─ ELSE:
│     │  │  │     └─ affected = [oldGroupingKey, newGroupingKey]
│     │  │  │
│     │  │  ├─ STEP 6: Synchronize product_dimension
│     │  │  │  └─ synchronizeProductDimension(platform, sourceProductId, { transaction: t })
│     │  │  │
│     │  │  ├─ STEP 7: Synchronize product_daily_metrics
│     │  │  │  └─ FOR EACH affectedKey in affected:
│     │  │  │     └─ synchronizeProductDailyMetrics(..., { transaction: t })
│     │  │  │
│     │  │  └─ COMMIT (or ROLLBACK on any error)
│     │  │     └─ Failure rolls back normalized_reviews + all syncs
│     │  │
│     │  └─ GUARANTEE: NO INTERMEDIATE STATE
│     │
│     └─ ELSE: No action (unchanged)

        ↓
        
DERIVED TABLES (NOW CURRENT)
│
├─ product_dimension ✅ (all columns synchronized)
├─ product_daily_metrics ✅ (all columns synchronized)
└─ (identity_anomalies — as detected)

        ↓
        
CONSUMPTION (Immediate Freshness)
│
├─ Rankings API
│  └─ SELECT FROM product_dimension/product_daily_metrics
│     └─ Returns CURRENT data ✅
│
├─ Analytics Dashboard
│  └─ SELECT FROM product_daily_metrics
│     └─ Returns CURRENT data ✅
│
└─ AI Analyst API
   └─ SELECT FROM normalized_reviews
      └─ Returns CURRENT data ✅

        ↓
        
SAFETY NET (Weekly)
│
└─ Full Rebuild
   ├─ Sunday 2 AM UTC
   ├─ TRUNCATE + full INSERT from normalized_reviews
   ├─ Deterministic recalculation
   ├─ Validation: SUM(review_count) == COUNT(normalized_reviews)
   └─ Catches any reviews updated outside 70-day TrackB window
      └─ Guarantees convergence within 7 days max
```

---

## CONCLUSION

**FINAL TRANSACTIONAL CONSISTENCY GUARANTEE:**

```
PRIMARY GUARANTEE:
  "After a successful ingestion cycle, normalized_reviews, product_dimension,
   and product_daily_metrics are transactionally consistent for all affected
   reviews."

SECONDARY GUARANTEE:
  "No successful ingestion cycle may leave normalized_reviews updated while
   product_dimension or product_daily_metrics still represent the previous
   state."
```

**IMPLEMENTATION REQUIREMENT:**

All TrackA/B synchronization must occur within the SAME TRANSACTION as the corresponding normalized_reviews change.

```
❌ NOT THIS (VIOLATES GUARANTEE):
   BEGIN TRANSACTION
     UPDATE normalized_reviews
   COMMIT
   
   BEGIN SEPARATE TRANSACTION
     UPDATE product_dimension/metrics
   COMMIT  ← Failure here leaves inconsistency

✅ THIS ONLY (SATISFIES GUARANTEE):
   BEGIN TRANSACTION
     UPDATE normalized_reviews
     UPDATE product_dimension
     UPDATE product_daily_metrics
   COMMIT  ← All or nothing
```

**TIMING:**

- ✅ TrackA: Synchronization during same batch transaction
- ✅ TrackB Discovery: Synchronization during same insert transaction
- ✅ TrackB Update: Synchronization during same update transaction
- ✅ Weekly Rebuild: Safety net (not primary mechanism)

**NO INTERMEDIATE STATE:**

- If normalized_reviews updates successfully, derived tables MUST synchronize before commit
- If derived synchronization fails, normalized_reviews MUST rollback
- Failure is visible (error logged, not silent)
- Rerun ingestion to recover (idempotent)

**WEEKLY REBUILD PURPOSE:**

- Catch edge cases outside 70-day TrackB window
- Validate consistency: SUM(review_count) == COUNT(normalized_reviews)
- Recovery from unknown bugs (should not be necessary)
- NOT the primary freshness mechanism

---

**DESIGN STATUS:** ✅ REVISED & CORRECTED

**CRITICAL CHANGES FROM ORIGINAL DESIGN:**

1. TrackB UPDATE branch is now ONE atomic transaction (not separate transactions)
2. Failure scenarios explicitly guarantee rollback of normalized_reviews
3. Test 15 added to prove atomic consistency under failure
4. Final guarantee explicitly states "no intermediate state"
5. Weekly rebuild is explicitly stated as safety net, not primary

**READY FOR:** User approval before Phase 3.2 implementation  
**PENDING:** Explicit user approval to proceed with coding
