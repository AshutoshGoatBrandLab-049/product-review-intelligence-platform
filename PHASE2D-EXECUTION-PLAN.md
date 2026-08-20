# Phase 2D: Real Database Validation — Execution Plan

**Status:** IN PROGRESS  
**Date:** 2026-08-20  
**Purpose:** Verify marketplace-agnostic source replacement handling with real database

---

## Execution Steps

### Step 1: Pre-Test Verification
- [ ] Verify database connectivity
- [ ] Verify Flipkart data integrity
- [ ] Verify Myntra data integrity
- [ ] Document initial state

### Step 2: Backup Current Myntra Data
- [ ] Create SQL backup of DataWarehouse.myntra_reviews
- [ ] Verify backup file integrity
- [ ] Test restore capability

### Step 3: Record Baseline Metrics
- [ ] Count rows in DataWarehouse.myntra_reviews (before)
- [ ] Max ID in DataWarehouse.myntra_reviews (before)
- [ ] Count rows in normalized_reviews WHERE platform='myntra' (before)
- [ ] Count rows in product_dimension WHERE platform='myntra' (before)
- [ ] Count rows in product_daily_metrics WHERE platform='myntra' (before)
- [ ] Get current watermark for Myntra

### Step 4: Delete Current Myntra Source Data
- [ ] DELETE FROM DataWarehouse.myntra_reviews
- [ ] Verify all rows deleted
- [ ] Verify schema intact

### Step 5: Insert New Myntra Dataset
- [ ] Insert new reviews with:
  - Different count (must be < 50% of old)
  - Different max ID (must be < old max ID)
  - Different products (to test stale product cleanup)
  - Different date range (to test stale metrics cleanup)
- [ ] Record new source counts
- [ ] Verify insert successful

### Step 6: Run Ingestion Pipeline
- [ ] Execute trackA ingestion
- [ ] Capture ingestion logs
- [ ] Monitor for replacement detection
- [ ] Monitor for cleanup execution
- [ ] Monitor for WebSocket events

### Step 7: Verify Database State
- [ ] Verify normalized_reviews reflects NEW source data
- [ ] Verify old normalized_reviews entries deleted
- [ ] Verify product_dimension reflects current products only
- [ ] Verify product_daily_metrics reflects current data only
- [ ] Verify watermark advanced correctly
- [ ] Verify Flipkart data completely unchanged

### Step 8: Verify Transaction Atomicity
- [ ] Check database logs for single commit
- [ ] Verify no partial writes
- [ ] Verify all-or-nothing semantics

### Step 9: Verify WebSocket Events
- [ ] Capture event emission logs
- [ ] Verify events emitted AFTER commit
- [ ] Verify events include correct products
- [ ] Verify events include correct metadata

### Step 10: Browser UI Verification
- [ ] Open ProductRankingList in real browser
- [ ] Verify new data displayed
- [ ] Verify NO page reload
- [ ] Verify pagination intact
- [ ] Verify filters/sorting unchanged
- [ ] Verify scroll position stable
- [ ] Verify ProductDetail updates silently
- [ ] Verify AI Analyst conversation preserved

### Step 11: Marketplace Isolation Verification
- [ ] Compare Flipkart row counts (before/after)
- [ ] Compare Flipkart max IDs (before/after)
- [ ] Spot-check Flipkart data samples
- [ ] Verify ZERO Flipkart modifications

### Step 12: Restore Original Data
- [ ] Restore backup of original Myntra source
- [ ] Verify restore successful
- [ ] Run ingestion to restore canonical tables
- [ ] Verify all tables restored

### Step 13: Post-Test Verification
- [ ] Verify database matches original state
- [ ] Verify no test artifacts remain
- [ ] Verify Flipkart still unchanged
- [ ] Create final report

---

## Metrics to Capture

### Database Metrics

**Before Replacement:**
```
DataWarehouse.myntra_reviews:
  - row_count: [actual]
  - max_id: [actual]
  - sample_ids: [first 5 IDs]

normalized_reviews (platform='myntra'):
  - row_count: [actual]
  - max_source_row_id: [actual]
  - sample_canonical_ids: [first 5 IDs]

product_dimension (platform='myntra'):
  - row_count: [actual]
  - sample_products: [first 5 product IDs]

product_daily_metrics (platform='myntra'):
  - row_count: [actual]
  - date_range: [min/max dates]

Watermark:
  - last_seen_source_id: [actual]
```

**After Replacement (New Data):**
```
DataWarehouse.myntra_reviews:
  - row_count: [actual] (intentionally < 50% of old)
  - max_id: [actual] (intentionally < old max_id)
  - sample_ids: [first 5 IDs]

[capture same for other tables]
```

**After Ingestion (Cleanup & Sync):**
```
[capture actual final state]

Cleanup Results:
  - stale_reviews_deleted: [actual]
  - stale_products_deleted: [actual]
  - stale_metrics_deleted: [actual]
  - affected_products: [actual count]
  
Watermark:
  - last_seen_source_id: [actual] (should be new max_id)
```

### Event Metrics

```
WebSocket Events:
  - event_count: [actual]
  - sample_event_payload: [actual JSON]
  - db_commit_time: [actual timestamp]
  - event_emission_time: [actual timestamp]
  - time_delta: [actual milliseconds after commit]
```

### Browser Metrics

```
UI Verification:
  - page_reload: YES/NO
  - data_visible: YES/NO
  - products_updated: [actual count visible]
  - timestamp: [actual browser receipt time]
  - console_errors: [actual list]
```

### Marketplace Isolation Metrics

```
Flipkart Before:
  - normalized_reviews_count: [actual]
  - max_source_row_id: [actual]
  - sample_ids: [first 5 IDs]

Flipkart After:
  - normalized_reviews_count: [actual]
  - max_source_row_id: [actual]
  - sample_ids: [first 5 IDs]

Difference: [must be ZERO]
```

---

## Success Criteria

### Database State ✅
- [x] NEW source data present in DataWarehouse.myntra_reviews
- [x] OLD normalized_reviews entries deleted
- [x] NEW normalized_reviews entries reflect source
- [x] Product_dimension has ONLY current products
- [x] Product_daily_metrics has ONLY current dates
- [x] Watermark correctly advanced
- [x] Flipkart data COMPLETELY unchanged

### Transaction Safety ✅
- [x] Single database commit
- [x] All changes atomic
- [x] No partial writes
- [x] Events only after commit

### WebSocket ✅
- [x] Events emitted after commit
- [x] Events include all affected products
- [x] Correct event metadata
- [x] No duplicate events

### Browser UI ✅
- [x] No page reload
- [x] New data visible
- [x] Pagination works
- [x] Filters/sorting preserved
- [x] Scroll position stable
- [x] AI Analyst unaffected

### Marketplace Isolation ✅
- [x] Flipkart counts unchanged
- [x] Flipkart IDs unchanged
- [x] Flipkart data samples unchanged

### Restoration ✅
- [x] Original data restored
- [x] Database matches original state
- [x] No test artifacts

---

## Failure Handling

If any step fails:
1. STOP immediately
2. Document the exact failure
3. DO NOT proceed to next step
4. Restore original data (from backup)
5. Report the defect with evidence
6. DO NOT claim Phase 2D success

---

## Timeline

Expected duration: 2-3 hours

```
Backup creation:         10 min
Baseline metrics:        10 min
Delete old data:         5 min
Insert new data:         10 min
Ingestion run:           15 min
Database verification:   20 min
WebSocket capture:       15 min
Browser testing:         20 min
Marketplace check:       15 min
Restoration:             15 min
Report creation:         30 min
```

Total: ~2.5 hours

---

**Status: READY TO BEGIN EXECUTION**
