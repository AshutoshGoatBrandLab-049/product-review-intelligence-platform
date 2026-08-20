# Option A Implementation - Complete Checklist

**Date:** 2026-08-20  
**Selected:** Option A - In-Process Ingestion  
**Timeline:** 1 hour to complete  
**Status:** Foundation in place, final test created

---

## What Option A Does

Instead of spawning a separate child process for ingestion:
- Calls `runIngestion()` as a direct TypeScript function in the server process
- WebSocket singleton is shared between ingestion and server
- Events emitted during ingestion automatically reach browser
- No inter-process communication needed

---

## Implementation Status

### ✅ Already Complete

1. **Export runIngestion() function** [runIngestion.ts:16]
   ```typescript
   export async function runIngestion(platform: Platform, jobId?: string)
   ```

2. **Create REST endpoint** [routes/ingestion.ts:1-45]
   ```typescript
   POST /internal/ingestion/trigger
   - Calls runIngestion() directly
   - Returns result with rowsInserted count
   ```

3. **Register route in Express** [router.ts:29, 155]
   ```typescript
   import ingestionRouter from "./routes/ingestion.js";
   apiRouter.use("/internal", ingestionRouter);
   ```

4. **Create comprehensive test** [phase3-option-a-final.spec.ts]
   - Tests complete flow: source data → ingestion → WebSocket → browser → API → UI
   - Tracks all steps with detailed logging
   - Captures evidence (screenshots, JSON results)

---

## How It Works

### Before Option A (Broken - Separate Processes)
```
Server Process:
├─ webSocketEventEmitter singleton (has listener)
└─ Browser connects ✅

Ingestion Process (SEPARATE):
├─ webSocketEventEmitter singleton (different instance!)
└─ broadcastEvent() goes nowhere ❌
```

### After Option A (Fixed - In-Process)
```
Server Process:
├─ webSocketEventEmitter singleton (has listener) ✅
├─ runIngestion() called directly (same process)
│  └─ broadcastEvent() reaches listener ✅
└─ Events sent to browser ✅
```

---

## Testing & Verification

### Current Test
- **File:** `frontend/tests/e2e/phase3-option-a-final.spec.ts`
- **Coverage:**
  - ✅ Source data insertion (100 rows)
  - ✅ In-process ingestion via REST API
  - ✅ WebSocket connection monitoring
  - ✅ Event reception detection
  - ✅ API call tracking
  - ✅ UI state verification
  - ✅ No page reload verification
  - ✅ Scroll preservation verification

### Expected Behavior
```
Step 1: Insert 100 test reviews
Step 2: Browser opens ProductRankingList (myntra/negative)
Step 3: Call POST /internal/ingestion/trigger
        ↓ (in-process, singletons shared)
Step 4: Wait 5 seconds for WebSocket events
Step 5: Verify:
        ✅ PRODUCT_DATA_UPDATED event received
        ✅ API call to /api/reviews made
        ✅ URL unchanged (no reload)
        ✅ Scroll preserved
```

---

## What Tests for Completeness

| Step | Test | Expected | Status |
|------|------|----------|--------|
| 1 | Source data | 100 rows inserted | ✅ |
| 2 | Ingestion | rowsInserted > 0 | ✅ (75+ in earlier tests) |
| 3 | DB commit | Rows in database | ✅ (verified with SQL) |
| 4 | WebSocket emit | Event type='PRODUCT_DATA_UPDATED' | ⏳ Testing |
| 5 | Browser receive | wsMessages[] has event | ⏳ Testing |
| 6 | API refresh | API call to /api/reviews/overview | ⏳ Testing |
| 7 | UI update | No page reload | ✅ (verified in previous tests) |
| 8 | State preserved | URL & scroll unchanged | ✅ (verified in previous tests) |

---

## Known Unknowns

**Issue from previous tests:** WebSocket events weren't reaching browser even with REST API call.

**Possible root causes:**
1. **affectedProducts empty** - Product IDs not being collected during ingestion
   - Debug: Check if sourceProductId is being set correctly
   - Fix: Verify product mapping from test data

2. **WebSocket listener registration** - Listener might not be registered when REST endpoint called
   - Debug: Verify eventEmitter.onBroadcast() is called at server startup
   - Fix: Ensure listener registered before API requests

3. **Event emission scope** - Issue with how events are collected/emitted
   - Debug: Add logging to show products being affected
   - Fix: Verify affectedProducts collection logic

**Solution:** The test will reveal which step is failing and guide the fix.

---

## Quick Commands

```bash
# Start services
cd backend && npm run dev &
cd frontend && npm run dev &
sleep 10

# Run Option A test
cd frontend && npx playwright test tests/e2e/phase3-option-a-final.spec.ts --headed

# Check results
cat frontend/phase3-option-a-final/03-results.json | jq .
```

---

## Success Criteria

✅ **Phase 3 Approved If All True:**

1. ✅ Source data inserted successfully
2. ✅ Ingestion runs without errors
3. ✅ Database shows new rows
4. ✅ WebSocket PRODUCT_DATA_UPDATED event received in browser
5. ✅ API call to /api/reviews/overview triggered
6. ✅ UI updates without page reload
7. ✅ URL remains unchanged
8. ✅ Scroll position preserved

---

## Next Steps

1. **Run the test:** `npx playwright test tests/e2e/phase3-option-a-final.spec.ts --headed`

2. **Review results:** Check `frontend/phase3-option-a-final/03-results.json`

3. **If events received:** ✅ Phase 3 approved, move to Phase 4

4. **If events NOT received:** 
   - Review the detailed logs in test output
   - Check affectedProducts collection
   - Verify WebSocket listener registration
   - Debug and fix root cause

5. **Commit & Deploy:**
   ```bash
   git add backend/src/modules/ingestion/runIngestion.ts
   git add backend/src/api/routes/ingestion.ts
   git add backend/src/api/router.ts
   git add frontend/tests/e2e/phase3-option-a-final.spec.ts
   git commit -m "Option A: In-process ingestion for WebSocket integration"
   ```

---

## Summary

**Option A Implementation:** ✅ Foundation complete  
**Final Test Created:** ✅ Comprehensive coverage  
**Ready to Verify:** ✅ Yes

**Next:** Run test and verify complete flow works end-to-end.

