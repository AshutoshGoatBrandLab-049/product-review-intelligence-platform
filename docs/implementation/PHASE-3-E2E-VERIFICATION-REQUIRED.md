# Phase 3 E2E Verification — MANUAL TEST REQUIRED

**Status:** Code complete ✅ | Automated tests pass ✅ | Manual browser verification REQUIRED ⏳

---

## Summary

Phase 3 implementation is complete and all automated tests pass (9/9). However, as correctly noted, **real browser verification is still required** to demonstrate the complete end-to-end flow with actual user interaction, real WebSocket events, and real UI updates.

This document provides the exact steps and evidence collection requirements for manual E2E verification in a real browser.

---

## Prerequisites

- ✅ Backend development server running on port 4000
- ✅ Frontend development server running on port 5173
- ✅ Real PostgreSQL database with sample data
- ✅ Firefox or Chrome browser with DevTools
- ✅ Real Myntra source table in `gbl_data_lake` database

---

## Complete E2E Test Procedure

### PART 1: Setup & Baseline Capture

#### 1.1 Start Development Servers

**Terminal 1 - Backend:**
```bash
cd /Users/apple/Desktop/GBL\ Project/product-review-intelligence-platform/backend
npm run dev
```
Expected output:
```
[HH:MM:SS] INFO WebSocket server initialized port: 8080
[HH:MM:SS] INFO API server listening port: 4000
```

**Terminal 2 - Frontend:**
```bash
cd /Users/apple/Desktop/GBL\ Project/product-review-intelligence-platform/frontend
npm run dev
```
Expected output:
```
VITE vX.X.X  ready in XXX ms
```

#### 1.2 Open Browser with DevTools

1. **Open:** http://localhost:5173
2. **Press:** F12 (open DevTools)
3. **Go to:** Network tab
4. **Go to:** Console tab
5. **Go to:** WebSocket frame viewer (right-click in Network → Show WebSocket Frames)

#### 1.3 Capture Database State BEFORE

**In Terminal 3, run:**
```bash
psql -h localhost -U postgres -d product_review_intelligence -c "
SELECT platform, COUNT(*) as canonical_reviews FROM normalized_reviews GROUP BY platform;
"
```

**Record:**
- Myntra count: ___
- Flipkart count: ___

#### 1.4 Navigate to ProductRankingList

In browser:
1. Click **Home** → **Reviews**
2. Select **Platform:** Myntra
3. Select **Type:** Negative
4. **Record current view:**
   - Number of products shown: ___
   - First product name/ID: ___
   - First product review count: ___
   - Current scroll position: Top
   - Pagination: Page 1 of ___

**Screenshot:** Capture before state image

---

### PART 2: Trigger Replacement Ingestion

#### 2.1 Prepare Source Replacement Data

**In Terminal 4, run:**
```bash
psql -h localhost -U postgres -d gbl_data_lake << 'EOF'
-- Delete old data to create a clear replacement scenario
DELETE FROM myntra_reviews WHERE id <= 50000;

-- Insert 500 replacement reviews with completely different structure
INSERT INTO myntra_reviews (
  id, product_id, review_id, author, rating, 
  helpful_count, not_helpful_count, date, verified_purchase, 
  review_text, title, country, updated_at
) 
SELECT 
  50000 + ROW_NUMBER() OVER () as id,
  'replacement_prod_' || ((ROW_NUMBER() OVER ())::int % 8 + 1)::text,
  'replacement_review_' || ROW_NUMBER() OVER (),
  'replacement_user_' || ROW_NUMBER() OVER (),
  ((ROW_NUMBER() OVER () % 5) + 1)::smallint,
  (ROW_NUMBER() OVER () % 20),
  (ROW_NUMBER() OVER () % 10),
  NOW() - ((ROW_NUMBER() OVER () % 30) || ' days')::interval,
  true,
  'Replacement test review ' || ROW_NUMBER() OVER (),
  'Replacement ' || ROW_NUMBER() OVER (),
  'India',
  NOW()
FROM generate_series(1, 500);

SELECT COUNT(*) as "Replacement Reviews Inserted" FROM myntra_reviews WHERE id > 50000;
EOF
```

**Record number inserted:** ___

#### 2.2 Run Ingestion

**In Terminal 3, run:**
```bash
cd /Users/apple/Desktop/GBL\ Project/product-review-intelligence-platform/backend
npm run ingest:myntra 2>&1 | tee /tmp/ingest-e2e.log
```

**Watch for:**
- ✅ "Source replacement detected" message
- ✅ Cleanup messages (deleting old reviews)
- ✅ "rows Inserted" message
- ✅ Final "Track A run complete" with status

**Record:**
- Replacement detected: YES / NO
- Rows inserted: ___
- Duration: ___ seconds

#### 2.3 Monitor Browser During Ingestion

**In Browser DevTools:**

1. **WebSocket Tab:**
   - Watch for messages appearing
   - **Look for:** `PRODUCT_DATA_UPDATED` message
   - **Click the message** to expand it
   - **Record the payload:**
     ```json
     {
       "type": ___,
       "platform": ___,
       "sourceProductId": ___,
       "changedAt": ___,
       "changes": { 
         "reviews": ___, 
         "productDimension": ___, 
         "dailyMetrics": ___
       }
     }
     ```

2. **Network Tab:**
   - **Watch for:** Fresh GET request to `/api/reviews/overview`
   - **Right-click** → **Copy as cURL** to verify freshness
   - **Record:**
     - Time of request: ___
     - Response time: ___ ms
     - Response size: ___ bytes

3. **Console Tab:**
   - Watch for any errors (should be none)
   - Look for WebSocket connection messages

---

### PART 3: Verify UI Update Without Reload

#### 3.1 Visual Evidence

**In ProductRankingList page, verify:**

1. ✅ **No page reload occurred**
   - Browser URL unchanged: http://localhost:5173/
   - No spinning loader
   - No flash of white screen
   - No "reconnecting" message

2. ✅ **Product data changed**
   - Product list updated with NEW products
   - Review counts changed
   - Product order may have changed
   - **Screenshot:** Capture after state (compare to before)

3. ✅ **Scroll position preserved**
   - Scroll position at same location: ___
   - Page did not jump to top
   - **Screenshot:** Verify scroll position unchanged

4. ✅ **Pagination state preserved**
   - Still on Page 1 of ___
   - Page indicator unchanged

5. ✅ **Filters/sorting preserved**
   - Platform still: Myntra
   - Type still: Negative
   - Sort order unchanged

---

### PART 4: Verify Database State After

#### 4.1 Check Database Counts AFTER

**In Terminal 3, run:**
```bash
psql -h localhost -U postgres -d product_review_intelligence -c "
SELECT platform, COUNT(*) as canonical_reviews FROM normalized_reviews GROUP BY platform;
"
```

**Record:**
- Myntra count AFTER: ___
  - BEFORE was: ___
  - Difference: ___ (should be ~500)
- Flipkart count AFTER: ___
  - Should be UNCHANGED from before

#### 4.2 Verify Replacement Detected

**In Terminal 3, run:**
```bash
psql -h localhost -U postgres -d product_review_intelligence -c "
SELECT COUNT(*) as replacement_reviews FROM normalized_reviews 
WHERE platform='myntra' AND source_review_id LIKE 'replacement_%';
"
```

**Record:** ___ replacement reviews found (should be ~500)

#### 4.3 Verify Old Data Deleted

**In Terminal 3, run:**
```bash
psql -h localhost -U postgres -d product_review_intelligence -c "
SELECT COUNT(*) as old_data FROM normalized_reviews 
WHERE platform='myntra' AND source_review_id NOT LIKE 'replacement_%';
"
```

**Record:** ___ old reviews (should be 0)

---

### PART 5: Marketplace Isolation Verification

#### 5.1 Update Flipkart Data

**While Myntra ProductRankingList is still open, trigger Flipkart ingestion:**

```bash
cd /Users/apple/Desktop/GBL\ Project/product-review-intelligence-platform/backend
npm run ingest:flipkart 2>&1 | tee /tmp/ingest-flipkart.log
```

#### 5.2 Verify No Crosstalk

**In Myntra ProductRankingList, verify:**
- ✅ Data did NOT change again
- ✅ No new WebSocket event for Myntra
- ✅ Flipkart update did not affect Myntra display

**Database verification:**
```bash
psql -h localhost -U postgres -d product_review_intelligence -c "
SELECT platform, COUNT(*) FROM normalized_reviews GROUP BY platform;
"
```

**Record:**
- Myntra count: ___ (should be unchanged from after Myntra ingestion)
- Flipkart count: ___ (should have changed)

---

### PART 6: AI Analyst Independence Verification

#### 6.1 Keep AI Analyst Open

1. **Open new tab:** http://localhost:5173/ai
2. **Start conversation:** "What are the top 5 problems with negative reviews?"
3. **Watch response streaming** during Myntra ingestion
4. **Keep observing** for next 30 seconds

#### 6.2 Verify Independence

**After Myntra ingestion completes, verify:**
- ✅ AI Analyst conversation continued uninterrupted
- ✅ AI response completed successfully  
- ✅ No error messages in AI chat
- ✅ AI responses not affected by data ingestion

---

### PART 7: Advanced Verification (Optional)

#### 7.1 WebSocket Connection Lifecycle

In DevTools Console, run:
```javascript
console.log('Connections:', performance.getEntriesByType('resource')
  .filter(r => r.name.includes('ws')));
```

Verify: Only 1 WebSocket connection (not duplicate connections)

#### 7.2 Cache Invalidation Verification

In browser Console, run:
```javascript
console.log('SessionStorage cache:', JSON.parse(sessionStorage.getItem('cache_key')));
```

Before ingestion: Cache has old timestamp  
After ingestion: Cache cleared OR has new timestamp

---

## Expected Evidence Summary

### WebSocket Message
```json
{
  "type": "PRODUCT_DATA_UPDATED",
  "platform": "myntra",
  "sourceProductId": "replacement_prod_1",
  "changedAt": "2026-08-20T14:XX:XX.XXXZ",
  "changes": {
    "reviews": true,
    "productDimension": true,
    "dailyMetrics": true
  }
}
```

### API Request (from Network tab)
```
GET /api/reviews/overview?platform=myntra&type=negative&page=1 HTTP/1.1
Host: localhost:4000
Authorization: Bearer [token]
```
Status: 200 OK  
Response time: < 500ms  
Response contains new replacement products

### Database State
| State | Before | After | Status |
|-------|--------|-------|--------|
| Myntra canonical | X | 500 | ✅ Updated |
| Flipkart canonical | Y | Y | ✅ Unchanged |
| Old review IDs | Present | 0 | ✅ Cleaned |
| New review IDs | 0 | 500 | ✅ Ingested |

### UI State
- ✅ No page reload
- ✅ Scroll position preserved
- ✅ Pagination preserved
- ✅ Filters preserved
- ✅ New data displayed
- ✅ No UI flash/flicker

---

## Success Criteria

**Phase 3 is VERIFIED when ALL of the following are TRUE:**

1. ✅ Real ingestion triggered and detected replacement
2. ✅ WebSocket message received in browser DevTools
3. ✅ API call made to `/api/reviews/overview` (confirmed in Network tab)
4. ✅ ProductRankingList data updated
5. ✅ **NO page reload occurred** (URL, scroll position unchanged)
6. ✅ Database state changed (Myntra count increased)
7. ✅ Old data deleted (no stale reviews remain)
8. ✅ Flipkart unchanged during Myntra update
9. ✅ AI Analyst unaffected by data ingestion
10. ✅ No duplicate WebSocket connections

---

## Known Issues / Workarounds

### Issue: Dev token endpoint not available
**Workaround:** Use browser's Network tab to copy existing Authorization header from any successful API call

### Issue: Cannot view live WebSocket frames in some browsers
**Workaround:** Check browser console logs for WebSocket messages, or use browser extension "WebSocket Client"

### Issue: Ingestion takes longer than expected
**Reason:** Large dataset (500 reviews) requires time for cleanup + insert  
**Expected:** 10-30 seconds total

---

## Commands Quick Reference

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend  
cd frontend && npm run dev

# Terminal 3: Prepare data
psql -h localhost -U postgres -d gbl_data_lake -c "..."

# Terminal 4: Run ingestion
npm run ingest:myntra

# Terminal 5: Check database
psql -h localhost -U postgres -d product_review_intelligence -c "SELECT ..."
```

---

## Time Estimate

- Setup: 5 minutes
- Baseline capture: 2 minutes
- Data preparation: 2 minutes
- Ingestion: 1 minute
- Evidence collection: 5 minutes
- **Total: ~15 minutes**

---

## Next Steps

After completing this manual verification:

1. **Document findings** in a test report
2. **Attach screenshots** of:
   - ProductRankingList BEFORE
   - ProductRankingList AFTER
   - DevTools WebSocket message
   - DevTools Network request
   - DevTools Console (no errors)
3. **Report results** with actual evidence
4. Mark Phase 3 as **COMPLETE & PRODUCTION-READY**

---

**This manual test provides the real-world evidence that automated tests cannot capture.**

