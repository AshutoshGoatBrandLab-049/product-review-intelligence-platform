# Phase 2D: Real Database Validation — Complete Execution Guide

**Status:** READY FOR EXECUTION  
**Date:** 2026-08-20  
**Estimated Duration:** 2-3 hours  
**Test Platform:** Myntra (implementation is marketplace-agnostic)

---

## Pre-Execution Checklist

- [ ] Database backup tools installed (`pg_dump`, `psql`)
- [ ] Node.js and npm installed
- [ ] Project dependencies installed (`npm install`)
- [ ] Backend code compiled/ready
- [ ] Ingestion pipeline tested in normal conditions
- [ ] Browser available for UI testing (Chrome/Firefox)
- [ ] Text editor ready for documentation
- [ ] Backup storage (local SSD, not cloud) prepared

---

## Quick Summary

This test will:

1. **Backup** current Myntra source data
2. **Delete** all Myntra reviews (intentionally creating "no new data" scenario)
3. **Insert** new test dataset (~50% smaller, max ID lower) to trigger replacement detection
4. **Run** ingestion pipeline (trackA)
5. **Verify** all database tables updated correctly
6. **Verify** WebSocket events emitted after commit
7. **Test** UI updates without page reload
8. **Restore** original Myntra data
9. **Document** all evidence in Phase 2D report

**Critical:** Do NOT modify Flipkart data. Myntra is the test case; the implementation is marketplace-agnostic.

---

## Detailed Execution Steps

### STEP 1: Database Connection Verification

**Verify you can connect to the database:**

```bash
psql -U postgres -d gbl_data_lake -h localhost -c "SELECT version();"
```

**Expected Output:**
```
PostgreSQL 12.x or higher on x86_64...
```

If this fails:
- [ ] Start PostgreSQL: `brew services start postgresql` (macOS)
- [ ] Check connection string in backend `.env` file
- [ ] Verify database `gbl_data_lake` exists

---

### STEP 2: Capture Baseline Metrics

**Run each query and record the output:**

#### 2a. Myntra Source Count (BEFORE)

```sql
SELECT 
  COUNT(*) as row_count,
  COALESCE(MAX(id), 0) as max_id,
  COALESCE(MIN(id), 0) as min_id
FROM "DataWarehouse".myntra_reviews;
```

**Record as:**
```
MYNTRA_SOURCE_BEFORE = {
  row_count: [actual],
  max_id: [actual],
  min_id: [actual]
}
```

#### 2b. Myntra Normalized Reviews (BEFORE)

```sql
SELECT 
  COUNT(*) as row_count,
  COALESCE(MAX(source_row_id), 0) as max_source_row_id
FROM app_store.normalized_reviews
WHERE platform = 'myntra';
```

**Record as:**
```
MYNTRA_NORMALIZED_BEFORE = {
  row_count: [actual],
  max_source_row_id: [actual]
}
```

#### 2c. Myntra Product Dimension (BEFORE)

```sql
SELECT 
  COUNT(*) as product_count,
  COUNT(DISTINCT source_product_id) as distinct_products
FROM app_store.product_dimension
WHERE platform = 'myntra';
```

**Record as:**
```
MYNTRA_PRODUCTS_BEFORE = {
  product_count: [actual],
  distinct_products: [actual]
}
```

#### 2d. Myntra Metrics (BEFORE)

```sql
SELECT 
  COUNT(*) as metric_count,
  MIN(review_date) as min_date,
  MAX(review_date) as max_date
FROM app_store.product_daily_metrics
WHERE platform = 'myntra';
```

**Record as:**
```
MYNTRA_METRICS_BEFORE = {
  metric_count: [actual],
  min_date: [actual],
  max_date: [actual]
}
```

#### 2e. Flipkart Source Baseline (for verification)

```sql
SELECT 
  COUNT(*) as row_count,
  COALESCE(MAX(id), 0) as max_id
FROM "DataWarehouse".flipkart_reviews;
```

**Record as:**
```
FLIPKART_SOURCE_BASELINE = {
  row_count: [actual],
  max_id: [actual]
}
```

#### 2f. Flipkart Normalized Baseline

```sql
SELECT 
  COUNT(*) as row_count,
  COALESCE(MAX(source_row_id), 0) as max_source_row_id
FROM app_store.normalized_reviews
WHERE platform = 'flipkart';
```

**Record as:**
```
FLIPKART_NORMALIZED_BASELINE = {
  row_count: [actual],
  max_source_row_id: [actual]
}
```

#### 2g. Current Watermarks

```sql
SELECT platform, last_seen_source_id
FROM app_store.ingestion_watermarks
WHERE platform IN ('myntra', 'flipkart')
ORDER BY platform;
```

**Record as:**
```
WATERMARKS_BEFORE = {
  myntra: [actual],
  flipkart: [actual]
}
```

---

### STEP 3: Create Database Backup

**Backup Myntra source data:**

```bash
pg_dump -U postgres \
  -d gbl_data_lake \
  -h localhost \
  -t '"DataWarehouse".myntra_reviews' \
  --no-owner \
  --no-privileges \
  > /tmp/myntra_reviews_backup.sql
```

**Verify backup:**

```bash
wc -l /tmp/myntra_reviews_backup.sql
# Expected: > 100 lines

head -20 /tmp/myntra_reviews_backup.sql
# Should show: CREATE TABLE, INSERT statements
```

**CRITICAL:** Keep this backup secure. This is your restore point.

---

### STEP 4: Delete Current Myntra Source Data

**⚠️ POINT OF NO RETURN - Backup verified? Proceed carefully.**

```sql
DELETE FROM "DataWarehouse".myntra_reviews;
```

**Verify deletion:**

```sql
SELECT COUNT(*) as row_count FROM "DataWarehouse".myntra_reviews;
-- Expected: 0 rows
```

**Record:**
```
DELETION_VERIFICATION = {
  rows_deleted: [actual count from DELETE output],
  rows_remaining: 0
}
```

---

### STEP 5: Insert New Myntra Test Dataset

The new data must:
- Be **intentionally smaller** (< 50% of original)
- Have **lower max ID** (< original max ID)
- Contain **different products** (to test cleanup)
- Have **different date range** (to test metrics cleanup)

**Insert test data:**

```sql
-- Insert new Myntra test dataset
-- This data is intentionally different from the original
-- to verify replacement detection and cleanup

INSERT INTO "DataWarehouse".myntra_reviews (
    id,
    product_id,
    review_id,
    rating,
    title,
    review_text,
    author,
    helpful_count,
    not_helpful_count,
    verified_purchase,
    review_date,
    review_timestamp,
    country,
    product_url,
    has_images,
    image_urls,
    size_purchased,
    color_purchased
) VALUES
-- Test Data Set: 50 new reviews from 5 new products
-- IDs: 1-50 (intentionally < old max_id for replacement detection)
-- Dates: 2026-08-15 to 2026-08-20 (different from original)
-- Products: prod_newA, prod_newB, prod_newC, prod_newD, prod_newE

(1, 'prod_newA', 'rev1_new', 5, 'Excellent quality', 'Really good product', 'reviewer1', 10, 2, true, '2026-08-15', '2026-08-15 10:00:00', 'India', 'https://www.myntra.com/p/prod_newA', false, NULL, 'M', 'Black'),
(2, 'prod_newA', 'rev2_new', 4, 'Good value', 'Nice product', 'reviewer2', 8, 1, true, '2026-08-16', '2026-08-16 11:00:00', 'India', 'https://www.myntra.com/p/prod_newA', false, NULL, 'L', 'White'),
(3, 'prod_newB', 'rev3_new', 5, 'Perfect fit', 'Excellent', 'reviewer3', 15, 0, true, '2026-08-16', '2026-08-16 14:00:00', 'India', 'https://www.myntra.com/p/prod_newB', true, '["url1", "url2"]', 'M', 'Blue'),
(4, 'prod_newB', 'rev4_new', 3, 'Average', 'Could be better', 'reviewer4', 5, 5, true, '2026-08-17', '2026-08-17 09:00:00', 'India', 'https://www.myntra.com/p/prod_newB', false, NULL, 'S', 'Red'),
(5, 'prod_newC', 'rev5_new', 4, 'Good design', 'Liked it', 'reviewer5', 12, 1, true, '2026-08-17', '2026-08-17 15:00:00', 'India', 'https://www.myntra.com/p/prod_newC', false, NULL, 'L', 'Black'),
-- ... Continue with 45 more records (IDs 6-50) distributed across 5 products
-- For brevity, generate these programmatically or copy from prepared dataset
-- Key: Total 50 reviews, 5 products, date range 2026-08-15 to 2026-08-20
;
```

**For actual execution, use a prepared dataset file:**

```bash
# If you have a CSV or prepared SQL file:
psql -U postgres -d gbl_data_lake -h localhost < myntra_test_data.sql
```

**Verify insertion:**

```sql
SELECT COUNT(*) as row_count, MAX(id) as max_id FROM "DataWarehouse".myntra_reviews;
-- Expected: row_count = ~50, max_id < MYNTRA_SOURCE_BEFORE.max_id
```

**Record:**
```
NEW_SOURCE_DATA = {
  row_count: [actual],
  max_id: [actual],
  product_count: [actual distinct products]
}
```

---

### STEP 6: Verify Replacement Detection Trigger Conditions

**Confirm the scenario matches replacement detection requirements:**

```sql
-- Get source counts
SELECT 
  (SELECT COUNT(*) FROM "DataWarehouse".myntra_reviews) as source_count,
  (SELECT COUNT(*) FROM app_store.normalized_reviews WHERE platform='myntra') as canonical_count,
  (SELECT COUNT(*) FROM "DataWarehouse".myntra_reviews) < 
    ((SELECT COUNT(*) FROM app_store.normalized_reviews WHERE platform='myntra') * 0.5) 
  as will_trigger_replacement
;
```

**Expected:** `will_trigger_replacement = true`

---

### STEP 7: Run Ingestion Pipeline

**Start the ingestion manually to capture detailed logs:**

```bash
# From project root
cd /Users/apple/Desktop/GBL\ Project/product-review-intelligence-platform

# Run ingestion with visible logs
npm run ingest:myntra 2>&1 | tee /tmp/ingestion_myntra_$(date +%s).log

# Or if that's not available, use the backend directly:
cd backend
npx ts-node src/modules/ingestion/runIngestion.ts --platform myntra 2>&1 | tee /tmp/ingestion_myntra.log
```

**Capture from logs:**

Look for these entries:

```
[INFO] Replacement detection data: platform=myntra, sourceCount=50, sourceMaxId=50, canonicalCount=[original], canonicalMaxSourceRowId=[original]
[INFO] Source replacement DETECTED
[INFO] Cleanup: staleReviewsDeleted=[actual], staleProductsDeleted=[actual], staleMetricsDeleted=[actual]
[INFO] WebSocket events emitted: [count]
[INFO] Track A run complete: staleReviewsDeleted=[X], staleProductsDeleted=[Y], staleMetricsDeleted=[Z]
```

**Record:**
```
INGESTION_RESULTS = {
  replacement_detected: true,
  stale_reviews_deleted: [actual],
  stale_products_deleted: [actual],
  stale_metrics_deleted: [actual],
  affected_products: [actual],
  events_emitted: [actual count],
  watermark_advanced_to: [actual max_id]
}
```

---

### STEP 8: Verify Database State After Ingestion

#### 8a. Myntra Normalized Reviews (AFTER)

```sql
SELECT 
  COUNT(*) as row_count,
  COALESCE(MAX(source_row_id), 0) as max_source_row_id
FROM app_store.normalized_reviews
WHERE platform = 'myntra';
```

**Expected:**
- row_count ≈ 50 (matches new source data)
- Completely different from MYNTRA_NORMALIZED_BEFORE

#### 8b. Verify OLD Reviews Deleted

```sql
-- Check for any reviews NOT in the new source dataset
SELECT COUNT(*) as orphaned_reviews
FROM app_store.normalized_reviews nr
WHERE nr.platform = 'myntra'
AND NOT EXISTS (
  SELECT 1 FROM "DataWarehouse".myntra_reviews mr
  WHERE mr.id = nr.source_row_id
);
```

**Expected: 0 rows** (no orphaned reviews)

#### 8c. Myntra Product Dimension (AFTER)

```sql
SELECT 
  COUNT(*) as product_count
FROM app_store.product_dimension
WHERE platform = 'myntra';
```

**Expected:** ≈ 5 products (only current products)

#### 8d. Verify Stale Products Deleted

```sql
-- Check for products with no reviews
SELECT COUNT(*) as orphaned_products
FROM app_store.product_dimension pd
WHERE pd.platform = 'myntra'
AND NOT EXISTS (
  SELECT 1 FROM app_store.normalized_reviews nr
  WHERE nr.platform = 'myntra'
  AND nr.source_product_id = pd.source_product_id
);
```

**Expected: 0 rows**

#### 8e. Myntra Metrics (AFTER)

```sql
SELECT 
  COUNT(*) as metric_count,
  MIN(review_date) as min_date,
  MAX(review_date) as max_date
FROM app_store.product_daily_metrics
WHERE platform = 'myntra';
```

**Expected:** Reflects only 2026-08-15 to 2026-08-20 date range

#### 8f. Watermark (AFTER)

```sql
SELECT last_seen_source_id
FROM app_store.ingestion_watermarks
WHERE platform = 'myntra';
```

**Expected:** = NEW_SOURCE_DATA.max_id (advanced correctly)

**Record:**
```
DATABASE_STATE_AFTER = {
  myntra_normalized_count: [actual],
  myntra_product_count: [actual],
  myntra_metrics_count: [actual],
  orphaned_reviews: 0,
  orphaned_products: 0,
  watermark: [actual]
}
```

---

### STEP 9: Verify Flipkart Unaffected

**CRITICAL: Confirm no Flipkart modifications**

```sql
SELECT 
  COUNT(*) as flipkart_normalized_count,
  COALESCE(MAX(source_row_id), 0) as max_source_row_id
FROM app_store.normalized_reviews
WHERE platform = 'flipkart';
```

**Expected:**
- flipkart_normalized_count = FLIPKART_NORMALIZED_BASELINE.row_count
- max_source_row_id = FLIPKART_NORMALIZED_BASELINE.max_source_row_id

```sql
SELECT COUNT(*) as flipkart_source_count, MAX(id) as max_id
FROM "DataWarehouse".flipkart_reviews;
```

**Expected:**
- flipkart_source_count = FLIPKART_SOURCE_BASELINE.row_count
- max_id = FLIPKART_SOURCE_BASELINE.max_id

**Record:**
```
FLIPKART_VERIFICATION = {
  source_count_match: YES/NO,
  normalized_count_match: YES/NO,
  max_id_match: YES/NO,
  status: "UNCHANGED" or "MODIFIED"
}
```

---

### STEP 10: Browser UI Verification

**Open browser and test:**

1. **Navigate to ProductRankingList:**
   ```
   URL: http://localhost:5173/products
   ```

2. **Verify new data visible:**
   - [ ] Products from new Myntra dataset visible
   - [ ] Old products NOT visible
   - [ ] Timestamps show recent dates (2026-08-15 onwards)

3. **Verify no page reload:**
   - [ ] Console shows NO full-page refresh messages
   - [ ] URL unchanged (still `/products`)
   - [ ] No spinner/loader indicators

4. **Verify pagination works:**
   - [ ] Pagination controls present
   - [ ] Clicking next/prev works
   - [ ] Page count reflects new data count

5. **Verify filters/sorting:**
   - [ ] Sort by rating works
   - [ ] Sort by date works
   - [ ] Filters still responsive

6. **Test ProductDetail page:**
   - [ ] Click on a Myntra product
   - [ ] Detail page loads with new data
   - [ ] No page reload

7. **Verify Flipkart data:**
   - [ ] Filter/select Flipkart products
   - [ ] Flipkart data still present and unchanged
   - [ ] Flipkart pagination works

8. **Verify AI Analyst:**
   - [ ] Ask a question about the new data
   - [ ] Response reflects new products/ratings
   - [ ] Conversation history preserved

**Record:**
```
BROWSER_VERIFICATION = {
  new_data_visible: YES/NO,
  old_data_absent: YES/NO,
  page_reload: YES/NO,
  pagination_works: YES/NO,
  filters_work: YES/NO,
  flipkart_unchanged: YES/NO,
  ai_analyst_works: YES/NO,
  console_errors: "[list or 'none']"
}
```

---

### STEP 11: Restore Original Data

**Restore from backup:**

```bash
psql -U postgres -d gbl_data_lake -h localhost < /tmp/myntra_reviews_backup.sql
```

**Verify restoration:**

```sql
SELECT COUNT(*) as row_count, MAX(id) as max_id
FROM "DataWarehouse".myntra_reviews;
```

**Expected:**
- row_count = MYNTRA_SOURCE_BEFORE.row_count
- max_id = MYNTRA_SOURCE_BEFORE.max_id

**Re-run ingestion to restore canonical tables:**

```bash
npm run ingest:myntra
```

**Verify restoration complete:**

```sql
SELECT COUNT(*) FROM app_store.normalized_reviews WHERE platform = 'myntra';
-- Should match MYNTRA_NORMALIZED_BEFORE.row_count
```

**Record:**
```
RESTORATION_RESULT = {
  backup_restored: YES/NO,
  row_count_matches: YES/NO,
  max_id_matches: YES/NO,
  canonical_tables_restored: YES/NO
}
```

---

## Summary Table

Create this table in the final report:

| Phase | Metric | Before | After Replacement | After Ingestion | After Restore | Status |
|-------|--------|--------|-------------------|-----------------|---------------|--------|
| Source | Myntra Count | [X] | 0 | [Y] | [X] | ✅ |
| Source | Max ID | [A] | - | [B<A] | [A] | ✅ |
| Canonical | Myntra Count | [M1] | [M1] | [M2<M1] | [M1] | ✅ |
| Canonical | Products | [P1] | [P1] | [P2<P1] | [P1] | ✅ |
| Canonical | Metrics | [T1] | [T1] | [T2<T1] | [T1] | ✅ |
| Watermark | Myntra | [W] | [W] | [B] | [W] | ✅ |
| Flipkart | All tables | [FK] | [FK] | [FK] | [FK] | ✅ UNCHANGED |

---

## Success Criteria Checklist

- [  ] Backup created and verified
- [  ] Baseline metrics captured
- [  ] Myntra source data deleted (0 rows)
- [  ] New Myntra test data inserted
- [  ] Replacement detection triggered (logs confirm)
- [  ] Cleanup executed (stale data deleted)
- [  ] Watermark advanced correctly
- [  ] Normalized reviews reflect new data only
- [  ] Products reflect current dataset only
- [  ] Metrics reflect current dates only
- [  ] No orphaned reviews/products/metrics
- [  ] WebSocket events emitted after commit
- [  ] Browser UI updated without page reload
- [  ] Flipkart data completely unchanged
- [  ] Original data successfully restored
- [  ] All evidence documented

---

## Evidence Documentation

Save to: `docs/implementation/PHASE2D-REAL-DATABASE-VERIFICATION.md`

Include:
1. Baseline metrics (actual values)
2. New data characteristics (row count, max ID, products, dates)
3. Ingestion log output (replace detection, cleanup counts)
4. After-ingestion database state (actual counts)
5. Flipkart verification (before/after unchanged)
6. WebSocket event samples (actual JSON)
7. Browser verification (screenshots or detailed description)
8. Restoration verification (restored counts)
9. Final status: SUCCESS or FAILURE
10. If failure: exact error message and step where it occurred

---

## Rollback Procedure

If anything goes wrong at any step:

```bash
# Restore from backup
psql -U postgres -d gbl_data_lake -h localhost < /tmp/myntra_reviews_backup.sql

# Re-run ingestion to restore canonical tables
npm run ingest:myntra

# Verify restoration
psql -U postgres -d gbl_data_lake -h localhost -c "SELECT COUNT(*) FROM \"DataWarehouse\".myntra_reviews;"
```

---

## Expected Timeline

- Backup creation: 5 minutes
- Baseline capture: 10 minutes
- Data deletion/insertion: 5 minutes
- Ingestion run: 15 minutes
- Verification: 30 minutes
- UI testing: 15 minutes
- Restoration: 10 minutes
- Documentation: 20 minutes
- **Total: ~1.5-2 hours**

---

## DO NOT Proceed Unless:

1. Backup verified and stored safely ✅
2. Database connectivity confirmed ✅
3. All baseline metrics captured ✅
4. Ready to intentionally modify data ✅
5. Can dedicate uninterrupted time to test ✅

---

**Status: READY FOR EXECUTION**

When complete, update: `docs/implementation/PHASE2D-REAL-DATABASE-VERIFICATION.md`

Submit evidence showing Phase 2D verification passed.
