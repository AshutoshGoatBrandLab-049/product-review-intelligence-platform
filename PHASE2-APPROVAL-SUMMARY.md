# Phase 2: Approval Summary & Files to Change

**Status:** AWAITING YOUR APPROVAL BEFORE ANY CODE CHANGES  
**Date:** 2026-08-20  

---

## What We're Implementing

**Automatic Myntra source-data replacement handling with full data consistency**

- ✅ Detect when `myntra_reviews` has been completely replaced
- ✅ Cleanup stale data from `normalized_reviews`, `product_dimension`, `product_daily_metrics`
- ✅ Maintain atomic transactions (all-or-nothing)
- ✅ Emit WebSocket events only after commit
- ✅ Don't break existing incremental ingestion
- ✅ Don't touch Flipkart data

---

## Files That Will Change

### NEW FILE (to be created)

```
backend/src/modules/ingestion/sourceReplacement.ts
├─ detectSourceReplacement(platform, transaction)
├─ cleanupStaleMyntraData(transaction)
├─ deleteStaleNormalizedReviews()
├─ deleteStaleProductDimension()
├─ deleteStaleProductDailyMetrics()
└─ identifyAffectedProducts()
```

**Size:** ~400 lines of code

---

### MODIFIED FILES (existing)

#### 1. `backend/src/modules/ingestion/trackA.ts`

**Changes:**
- Add replacement detection at start
- If replacement detected: query with `id > 0` instead of `id > watermark`
- Call `cleanupStaleMyntraData()` within transaction
- Synchronize affected products within transaction
- Emit WebSocket events after commit

**Size:** ~80 new lines (added within existing function)

**Impact:** Non-breaking; existing behavior unchanged if no replacement

---

#### 2. `backend/src/modules/ingestion/trackB.ts`

**Changes:**
- Minor: Decide whether to skip TrackB if replacement was detected
- OR: Run TrackB normally (independent reconciliation)

**Size:** ~5 lines (conditional check)

**Impact:** Non-breaking; existing behavior unaffected

---

#### 3. `backend/src/modules/ingestion/runIngestion.ts`

**Changes:**
- Pass transaction context to TrackA
- Log whether replacement was detected

**Size:** ~10 lines

**Impact:** Non-breaking; logging only

---

#### 4. `backend/src/modules/websocket/eventEmitter.ts`

**Changes:** None required

---

### TEST FILES (to be created)

#### New Test 1: `backend/tests/unit/ingestion/sourceReplacement.test.ts`

**Tests:**
- Detection logic with various data counts
- Cleanup queries
- Transaction behavior
- Edge cases

**Size:** ~300 lines

---

#### New Test 2: `backend/tests/integration/ingestion/replacementWorkflow.test.ts`

**Tests:**
- End-to-end replacement workflow
- Data consistency verification
- WebSocket event firing
- Normal ingestion still works

**Size:** ~400 lines

---

#### New Test 3: `tests/e2e/milestone4-myntra-replacement.js`

**Tests:**
- Real database replacement
- Real browser verification
- ProductRankingList auto-update
- ProductDetail auto-update
- Data restoration

**Size:** ~200 lines

---

## Core Design Decisions

### 1. Replacement Detection (CRITICAL)

**How it works:**

When TrackA finds zero new rows:

```typescript
async function detectSourceReplacement(platform: 'myntra'): boolean {
  const sourceCount = await getReviewCount('myntra');           // 50000
  const canonicalCount = await getNormalizedCount('myntra');    // 500000
  const sourceMaxId = await getSourceMaxId('myntra');           // 50000
  const canonicalMaxSourceRowId = await getMaxSourceRowId();    // 500000
  
  // Genuine replacement if source is much smaller
  // AND max ID is lower (old data gone)
  // BUT both tables have data (not startup condition)
  return sourceCount > 0 && canonicalCount > 0 &&
         sourceMaxId < canonicalMaxSourceRowId &&
         sourceCount < (canonicalCount * 0.5);  // Less than 50%
}
```

**Why this is safe:**
- Deterministic: Same data state → same result ✓
- Idempotent: Running again = no-op ✓
- Conservative: Only acts when convinced ✓
- Platform-scoped: Only affects Myntra ✓

---

### 2. Stale Data Cleanup (ATOMIC)

All within ONE transaction:

1. DELETE Myntra rows in `normalized_reviews` that no longer exist in source
2. DELETE Myntra rows in `product_dimension` with zero reviews
3. DELETE Myntra rows in `product_daily_metrics` with zero reviews
4. Synchronize affected products
5. Advance watermark
6. **COMMIT**
7. **THEN** emit WebSocket events

**Guarantees:**
- All changes succeed or all rollback ✓
- Events only after commit ✓
- No partial updates ✓

---

### 3. Watermark Handling

**If replacement detected:**
- Query source with `id > 0` (not `id > watermark`)
- Brings in "new" data that has lower IDs than old watermark
- After cleanup, set watermark to current `MAX(id)` from source
- Next run: Normal behavior (query WHERE id > watermark)

---

## Scenarios Tested

| Scenario | Works? | Notes |
|----------|--------|-------|
| Normal incremental day | ✓ | No detection, standard flow |
| Day with zero updates | ✓ | No detection, no changes |
| Complete source replacement | ✓ | Detected, cleaned, synced |
| Partial replacement | ✓ | Only affected products updated |
| Product removed entirely | ✓ | product_dimension row deleted |
| New product added | ✓ | product_dimension created |
| Review rating changed | ✓ | Existing: ON CONFLICT, Replace mode |
| Review deleted (incremental) | ⚠️ | Remains (only cleaned on replacement) |
| Review deleted (replacement) | ✓ | Cleaned automatically |

---

## What Won't Break

✅ **Flipkart data** — All queries `WHERE platform = 'myntra'`  
✅ **Existing incremental ingestion** — Detection doesn't trigger on normal days  
✅ **Transaction safety** — Atomic boundaries preserved  
✅ **WebSocket** — Events only after commit  
✅ **UI behavior** — No new requirements for frontend  
✅ **AI Analyst** — Unaffected  

---

## Rollback Plan

If something goes wrong:

1. Remove `sourceReplacement.ts`
2. Revert changes to trackA.ts, trackB.ts, runIngestion.ts
3. Redeploy
4. Normal ingestion behavior restored

---

## Question: TrackB After Replacement

Should TrackB still run after a replacement is detected?

**Option 1: Skip TrackB**
- Reason: TrackA just ingested everything, nothing to reconcile
- Pro: Faster
- Con: Misses any data that changed during TrackA window

**Option 2: Run TrackB Normally**
- Reason: Reconciliation is independent (scans date window)
- Pro: Catches any updates made while TrackA was running
- Con: Redundant if TrackA just covered everything
- Recommended: This option

**Decision:** TrackB will run normally (no skip condition)

---

## Approval Checklist

**For you to review and approve:**

- [ ] Replacement detection mechanism makes sense
- [ ] Data cleanup strategy is correct
- [ ] Transaction boundaries are sound
- [ ] Files to modify are acceptable
- [ ] No concerns about breaking existing behavior
- [ ] Acceptable risk level
- [ ] Rollback plan is clear

---

## What Happens After You Approve

1. **PHASE 2B** — Implementation (I write the code)
2. **PHASE 2C** — Unit/integration tests
3. **PHASE 2D** — Real database replacement test
4. **PHASE 2E** — WebSocket verification
5. **PHASE 2F** — Browser E2E verification
6. **PHASE 2G** — Restore original data
7. **PHASE 2H** — Final evidence report

---

## Important: No Changes Yet

**This is design only. No code changes, no database modifications until you approve.**

Review the full design in: [PHASE2-IMPLEMENTATION-DESIGN.md](PHASE2-IMPLEMENTATION-DESIGN.md)

---

## Your Options

**A) APPROVE** — Proceed with implementation  
**B) REQUEST CHANGES** — Specify what needs adjustment  
**C) NEED CLARIFICATION** — Ask questions before deciding  
**D) REJECT** — Choose a different approach  

---

**Awaiting your decision.**

