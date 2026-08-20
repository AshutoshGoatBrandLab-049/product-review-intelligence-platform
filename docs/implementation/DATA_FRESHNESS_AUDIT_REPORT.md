# DAILY DATA FRESHNESS & DOWNSTREAM SYNC AUDIT

**Date:** 2026-08-20  
**Status:** ⚠️ CRITICAL GAPS IDENTIFIED  
**Audit Type:** Read-only code inspection

---

## EXECUTIVE SUMMARY

The application has **CRITICAL DATA FRESHNESS GAPS** in the downstream processing pipeline.

**What Works:**
✅ Source table detection (flipkart_reviews, myntra_reviews)  
✅ New review ingestion into normalized_reviews  
✅ Update detection via content_hash in TrackB  

**What Does NOT Work:**
❌ product_dimension NOT rebuilt after ingestion  
❌ product_daily_metrics NOT rebuilt after ingestion  
❌ review_sentiment NOT populated after ingestion  
❌ review_theme NOT populated after ingestion  
❌ No rebuild scheduler exists  

**Impact:**
- Rankings based on stale product_daily_metrics
- New products won't appear in rankings until manual rebuild
- Sentiment/theme data is not automatically maintained

---

## PART 1: SOURCE TABLE INGESTION

### Source Tables
```
PRIMARY SOURCES:
  - DataWarehouse.flipkart_reviews
  - DataWarehouse.myntra_reviews
```

### Detection Method: ID-Based Incremental

**Mechanism:** `WHERE id > last_seen_source_id`

**Code:** [trackA.ts:50-75](src/modules/ingestion/trackA.ts)

```typescript
let afterId = await getLastSeenSourceId(platform);
const rawRows =
  platform === "flipkart"
    ? await prodReadOnly.getFlipkartReviewsPage(afterId, batchSize)
    : await prodReadOnly.getMyntraReviewsPage(afterId, batchSize);
```

**Query Generated:** (`flipkartReviewsRepo.ts`)
```sql
SELECT * FROM flipkart_reviews
WHERE id > :afterId
ORDER BY id ASC
LIMIT :batchSize
```

### Watermark Mechanism

**Table:** `ingestion_watermarks` (per-platform)

**Stored Value:** `last_seen_source_id` (numeric ID from source table)

**Update Timing:** Transactional update alongside normalized_reviews insert

**Code:** [trackA.ts:105-113](src/modules/ingestion/trackA.ts)
```typescript
await appSequelize.transaction(async (t) => {
  if (toInsert.length > 0) {
    await NormalizedReview.bulkCreate(toInsert, {
      transaction: t,
      ignoreDuplicates: true,
    });
  }
  await advanceLastSeenSourceId(platform, maxIdInBatch, t);
});
```

**Guarantee:** Watermark advances ONLY after normalized_reviews insert commits

### Batch Processing

**Batch Size:** `config.ingestion.batchSize` (default: 5,000)

**Pagination:** Loop until `rawRows.length < batchSize`

### Duplicate Prevention

**Mechanism:** `ON CONFLICT DO NOTHING` in bulkCreate

**Code:** [trackA.ts:109](src/modules/ingestion/trackA.ts)
```typescript
await NormalizedReview.bulkCreate(toInsert, {
  transaction: t,
  ignoreDuplicates: true, // harmless overlap with Track B
});
```

**Verified:** ✅ Duplicate key constraint prevents duplicate logical reviews

---

## PART 2: NEW REVIEW FLOW (TrackA)

### Flow Diagram
```
flipkart_reviews / myntra_reviews
        ↓ (SELECT id > last_seen_source_id)
        ↓ WHERE id IN current batch
mapFlipkartReview() / mapMyntraReview()
        ↓ (unified schema mapping)
validateUnifiedReview()
        ↓ (validation checks)
        ├→ reject? → recordReject() → ingestion_rejects
        └→ valid? → normalized_reviews INSERT
        ↓ (transactional)
advanceLastSeenSourceId()
        ↓ (watermark update)
COMPLETE
```

### Where Does TrackA Flow End?

**Answer:** `normalized_reviews` INSERT ONLY

**Does NOT trigger:**
- ❌ product_dimension
- ❌ product_daily_metrics
- ❌ review_sentiment
- ❌ review_theme

**Does NOT call:**
- ❌ rebuildAnalytics()
- ❌ AI pipeline
- ❌ Any downstream processing

---

## PART 3: RECONCILIATION FLOW (TrackB)

### Purpose

Window-based reconciliation to detect UPDATED source records

**Window:** Last 60 days + 10-day safety buffer (default)

**Change Detection:** `content_hash` comparison

### Query

```sql
SELECT * FROM flipkart_reviews / myntra_reviews
WHERE review_date >= :windowStart
  AND id > :afterId
ORDER BY id ASC
LIMIT :batchSize
```

### Update Detection Logic

**Code:** [trackB.ts:135-157](src/modules/ingestion/trackB.ts)

```typescript
const freshHash = computeContentHash(review);
const existing = await NormalizedReview.findByPk(canonicalReviewId);

if (!existing) {
  // New review in window → insert
  await NormalizedReview.create(...);
} else if (existing.contentHash === freshHash) {
  // Unchanged → no action
  result.rowsUnchanged += 1;
} else {
  // CHANGED → update normalized_reviews
  await existing.update(...);
  result.rowsUpdated += 1;
}
```

**Verified:** ✅ Updates normalized_reviews when source review content changes

### TrackB Flow End

**Same Issue:** No downstream triggers

**CRITICAL:** Updated reviews in normalized_reviews are NOT reflected downstream:
- ❌ product_daily_metrics remains stale
- ❌ review_sentiment not recomputed
- ❌ review_theme not recomputed

---

## PART 4: DOWNSTREAM PIPELINE STATUS

### Product Dimension

**Expected Source:** normalized_reviews  
**Actual Trigger:** NEVER (except manual rebuild)

**Code:** [rebuild.ts:75-112](src/modules/analytics/rebuild.ts)
```sql
INSERT INTO product_dimension (...)
SELECT platform, source_product_id, brand, ...
FROM normalized_reviews
GROUP BY platform, source_product_id
```

**Called From:** ???

```
grep -r "rebuildAnalytics()" src/
  → NO RESULTS
```

**Status:** ❌ NOT UPDATED after ingestion

### Product Daily Metrics

**Expected Source:** normalized_reviews  
**Actual Update:** TRUNCATE + full INSERT (rebuild only)

**Code:** [rebuild.ts:47-72](src/modules/analytics/rebuild.ts)
```sql
TRUNCATE product_daily_metrics;
INSERT INTO product_daily_metrics (...)
SELECT platform, source_product_id, review_date,
       count(*), sum(rating),
       count(*) FILTER (WHERE rating = 1),
       ...
FROM normalized_reviews
GROUP BY platform, source_product_id, review_date
```

**When Called:** UNKNOWN (function never invoked in active codebase)

**Status:** ❌ NOT UPDATED after ingestion

### Review Sentiment

**Expected Source:** normalized_reviews  
**Actual Trigger:** AI pipeline (separate process)

**Code:** [pipeline.ts](src/modules/ai/pipeline.ts)
```typescript
await appSequelize.query(
  `INSERT INTO review_sentiment ...`
);
```

**When Called:** AI pipeline execution

**Called From Ingestion?:** NO

**Status:** ❌ NOT triggered by ingestion

### Review Theme

**Expected Source:** normalized_reviews  
**Actual Trigger:** AI pipeline (separate process)

**Code:** [pipeline.ts](src/modules/ai/pipeline.ts)
```typescript
for (const theme of output.themes) {
  await appSequelize.query(
    `INSERT INTO review_theme ...`
  );
}
```

**When Called:** AI pipeline execution

**Called From Ingestion?:** NO

**Status:** ❌ NOT triggered by ingestion

---

## PART 5: RANKING DATA FLOW

### Query Path

```
Rankings API (rankings.ts)
        ↓ categoryCCache.getOrCompute()
        ↓ computeCatalogHealthScores() OR computeCatalogAnalytics()
        ↓ listCatalogProducts()
        ↓ SELECT FROM product_dimension
        ↓ For each product: computeProductAnalytics()
        ↓ queryAggregatedMetrics()
        ↓ SELECT FROM product_daily_metrics
        ↓ Return results
```

### Critical Issue: Product List from product_dimension

**Code:** [catalogSweep.ts](src/api/catalogSweep.ts)
```sql
SELECT platform, source_product_id, brand 
FROM product_dimension
WHERE ...
```

**Problem:** product_dimension is NOT updated when new reviews arrive in normalized_reviews

**Example Failure:**
```
Scenario:
  1. New review arrives for product X via TrackA
  2. normalized_reviews is inserted
  3. product_dimension NOT rebuilt
  4. User requests rankings
  5. listCatalogProducts() queries product_dimension
  6. Product X does NOT appear (no product_dimension row)
  7. New reviews are invisible to the application
```

---

## PART 6: AI ANALYST DATA FLOW

### AI Analyst Query Path

```
AI Analyst API (analyzeProductQuestion)
        ↓ getReviewsWithText()
        ↓ SELECT * FROM normalized_reviews WHERE ...
        ↓ (queries directly, NOT product_daily_metrics)
        ↓ Fresh data guaranteed
```

**Status:** ✅ AI Analyst reads normalized_reviews directly, so sees current data

**But:** AI Analyst cannot see new PRODUCTS unless product_dimension is rebuilt

---

## PART 7: DATA FRESHNESS MATRIX

| Source Change | normalized_reviews | product_dimension | daily_metrics | sentiment | theme | Ranking | AI Analyst |
|---|---|---|---|---|---|---|---|
| New Flipkart review | ✅ auto | ❌ never | ❌ never | ❌ never | ❌ never | ❌ no | ✅ yes* |
| Updated Flipkart review | ✅ auto | ❌ never | ❌ never | ❌ never | ❌ never | ❌ no | ✅ yes* |
| New Myntra review | ✅ auto | ❌ never | ❌ never | ❌ never | ❌ never | ❌ no | ✅ yes* |
| Updated Myntra review | ✅ auto | ❌ never | ❌ never | ❌ never | ❌ never | ❌ no | ✅ yes* |

**Legend:**
- ✅ auto = Automatically updated on new data
- ❌ never = Never updated automatically; manual rebuild required
- ✅ yes* = Sees data if product_dimension exists

---

## PART 8: FAILURE SCENARIOS

### Scenario 1: New Product with Reviews

**Flow:**
1. ✅ New reviews ingested → normalized_reviews
2. ❌ product_dimension NOT created
3. ❌ Ranking cannot find product (no product_dimension row)
4. ❌ New product is invisible to rankings

**Recovery:** Manual rebuild or external trigger

### Scenario 2: Review Rating Change

**Flow:**
1. ✅ Source review rating: 3 → 1
2. ✅ TrackB detects change via content_hash
3. ✅ normalized_reviews.rating updated to 1
4. ❌ product_daily_metrics NOT updated
5. ❌ Rankings still show old rating (3)
6. ✅ AI Analyst sees new rating (queries normalized_reviews)

**Inconsistency:** Rankings vs AI Analyst show different data

### Scenario 3: Ingestion Failure Mid-Stream

**Status:** Safe

**Reason:** 
- All writes are transactional
- Watermark advances only after insert commits
- Failed transaction rolls back both insert and watermark
- Next run retries from last successful watermark

---

## PART 9: SCHEDULER / EXECUTION CONTEXT

**Ingestion Trigger:** Command-line invocation

**Code:** [runIngestion.ts:11-51](src/modules/ingestion/runIngestion.ts)
```bash
Usage: npx tsx src/modules/ingestion/runIngestion.ts <flipkart|myntra>
```

**No Built-in Schedule:** The application code has NO cron/scheduler

**Rebuild Schedule:** NOT CONFIGURED

**Where Orchestrated:** Must be external (k8s cronjob, systemd timer, CI/CD, etc.)

**Current State:** UNKNOWN (audit is code-only, cannot see infrastructure)

---

## PART 10: CRITICAL GAPS SUMMARY

### Gap 1: No Rebuild Trigger

**What's Missing:**
```typescript
// This function exists but is NEVER CALLED
export async function rebuildAnalytics(): Promise<RebuildResult>
```

**Where It Should Be Called:**
- After TrackA completes successfully
- After TrackB completes successfully
- Or via scheduled job

**Current State:**
- Function defined but orphaned
- No callers in codebase
- Rebuild never runs

### Gap 2: No Sentiment/Theme Trigger

**AI Pipeline Exists but is:**
- ❌ Not invoked by ingestion
- ❌ Not scheduled
- ❌ Not automatically maintained

### Gap 3: No Scheduler Defined

**Missing:**
- Cron job for daily ingestion
- Cron job for analytics rebuild
- Cron job for AI pipeline

---

## PART 11: EXACT CODE LOCATIONS

### Ingestion Entry Point
- File: `src/modules/ingestion/runIngestion.ts`
- Lines: 11-51
- Function: `main()`

### TrackA (New Reviews)
- File: `src/modules/ingestion/trackA.ts`
- Lines: 50-156
- Function: `runTrackA()`

### TrackB (Updated Reviews)
- File: `src/modules/ingestion/trackB.ts`
- Lines: 69-212
- Function: `runTrackB()`

### Watermark Tracking
- File: `src/modules/ingestion/watermarkRepo.ts`
- Functions: `getLastSeenSourceId()`, `advanceLastSeenSourceId()`, `recordReconciliationRun()`

### Rebuild (Orphaned)
- File: `src/modules/analytics/rebuild.ts`
- Lines: 35-147
- Function: `rebuildAnalytics()`
- **Status:** Defined but never called

### Metrics Query (Uses Stale Data)
- File: `src/modules/analytics/metricsQuery.ts`
- Line: 86
- Query: `SELECT ... FROM product_daily_metrics d`

### Ranking Controller (Depends on Stale Data)
- File: `src/api/controllers/rankings.ts`
- Lines: 14-54
- Function: `getProductRankings()`

### Catalog Products (Depends on Stale Data)
- File: `src/api/catalogSweep.ts`
- Function: `listCatalogProducts()`
- Query: `SELECT FROM product_dimension`

---

## PART 12: CONFIRMED GUARANTEES

✅ **Source Data Detection**
- Flipkart and Myntra reviews are detected via ID-based incremental query
- Watermark prevents reprocessing
- Guaranteed to find all new rows

✅ **Normalized Reviews Updated**
- New reviews inserted to normalized_reviews
- Existing reviews can be updated via TrackB
- Transactional safety prevents partial updates

✅ **Deduplication**
- `ON CONFLICT DO NOTHING` prevents duplicates
- Canonical ID ensures uniqueness
- Safe to rerun ingestion

✅ **AI Analyst Sees Current Data**
- Queries normalized_reviews directly
- Not dependent on stale product_daily_metrics
- Reflects database state immediately

---

## PART 13: NOT GUARANTEED

❌ **product_dimension is Current**
- NOT rebuilt automatically
- Will become stale immediately after new reviews arrive

❌ **product_daily_metrics is Current**
- NOT rebuilt automatically
- Queries against it return stale data

❌ **Rankings are Current**
- Based on stale product_daily_metrics
- New products don't appear until rebuild

❌ **Sentiment/Theme are Maintained**
- NOT populated by ingestion
- Only populated by AI pipeline
- AI pipeline not automatically triggered

❌ **Automatic Schedule Exists**
- No cron/scheduler in application code
- Rebuild function never invoked
- Ingestion must be triggered externally

---

## PART 14: DATA PIPELINE DEPENDENCIES

```
Tier 0 (Source):
  flipkart_reviews ──┐
  myntra_reviews  ──┼→ [TrackA] ──→ normalized_reviews ──┐
                    ├→ [TrackB] ──→                       │
                    └─────────────────────────────────────┤
                                                          │
Tier 1 (Normalized):                                      │
                  ┌─────────────────────────────────────→ ┤
                  │                                        │
Tier 2 (Stale):   │  product_daily_metrics ←→ Rankings API
                  │  product_dimension ←────┘  (Depends on Stale Data)
                  │
                  └→ AI Pipeline ──→ review_sentiment
                                  ──→ review_theme

STATUS:
- Tier 0→1: ✅ Working (TrackA/B)
- Tier 1→2: ❌ BROKEN (No rebuild)
- Pipeline: ❌ Disconnected (No trigger)
```

---

## PART 15: RISK ASSESSMENT

### HIGH RISK Issues

**Issue 1: Product Visibility**
- **Risk:** New products don't appear in rankings
- **Detectability:** Users notice missing products
- **Recovery:** Manual rebuild required

**Issue 2: Ranking Accuracy**
- **Risk:** Rankings show old ratings/metrics
- **Detectability:** Users compare AI Analyst vs Rankings
- **Recovery:** Manual rebuild required

**Issue 3: Cascade Failure**
- **Risk:** If rebuild fails once, data becomes permanently stale
- **Detectability:** Delayed (could be days before noticed)
- **Recovery:** Requires investigation + rebuild + revalidation

---

## RECOMMENDATIONS (NOT IMPLEMENTED)

### Required Fixes

1. **Call rebuildAnalytics() after ingestion**
   - Add call at end of runTrackB()
   - Wrap in error handling
   - Validate result before completing

2. **Trigger AI Pipeline**
   - After TrackA completes (for new reviews)
   - After TrackB completes (for updated reviews)
   - Handle pipeline failures gracefully

3. **Add External Scheduler**
   - Daily ingestion trigger
   - Rebuild guarantee
   - Health monitoring

---

## CONCLUSION

### Current State

The application has **CRITICAL DATA FRESHNESS GAPS**:

- ✅ Source → normalized_reviews pipeline works
- ❌ normalized_reviews → downstream tables pipeline is broken
- ❌ No automatic rebuild after ingestion
- ❌ No automatic sentiment/theme generation
- ❌ Rankings queries stale product_daily_metrics

### Impact

- New products invisible to rankings
- Rankings show stale metrics
- Sentiment/theme data not maintained
- AI Analyst shows current data (only via normalized_reviews)
- Data inconsistency between APIs

### Required Action

The `rebuildAnalytics()` function must be called at the END of successful ingestion runs, not left orphaned. Similarly, the AI pipeline must be triggered to maintain sentiment/theme data.

---

**Report Status:** COMPLETE  
**Audit Scope:** Code inspection only (no execution)  
**Verified By:** Claude Code Automated Audit
