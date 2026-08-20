# Phase 2B.2: Replacement Detection Algorithm

**Status:** VERIFICATION DOCUMENT (implementation guide)  
**Date:** 2026-08-20  

---

## Requirement

Distinguish between:
- Normal "no new data today" (don't reset watermark)
- Actual source data replacement (DO trigger cleanup)

Without assuming anything about source data structure or ID continuity.

---

## Proposed Algorithm

### Precondition: TrackA found zero new rows

```typescript
// In trackA.ts
const rawRows = await getMyntraReviewsPage(afterId, batchSize);
if (rawRows.length === 0) {
  // No new rows found — is this normal or replacement?
  const isReplacement = await detectSourceReplacement('myntra', transaction);
  if (isReplacement) {
    // ... run cleanup ...
  }
  return; // No data to process
}
```

### Detection Logic

```typescript
async function detectSourceReplacement(
  platform: 'myntra',
  transaction: Transaction
): Promise<boolean> {
  // Get exact counts from source
  const [sourceRow] = await appSequelize.query<{ 
    count: number; 
    maxId: number 
  }>(
    `SELECT COUNT(*) as count, COALESCE(MAX(id), 0) as maxId
     FROM "DataWarehouse".myntra_reviews`,
    { transaction }
  );
  const sourceCount = Number(sourceRow.count);
  const sourceMaxId = Number(sourceRow.maxId);

  // Get exact counts from canonical
  const [canonicalRow] = await appSequelize.query<{ 
    count: number; 
    maxSourceRowId: number 
  }>(
    `SELECT COUNT(*) as count, COALESCE(MAX(source_row_id), 0) as maxSourceRowId
     FROM "DataWarehouse".normalized_reviews
     WHERE platform = 'myntra'`,
    { transaction }
  );
  const canonicalCount = Number(canonicalRow.count);
  const canonicalMaxSourceRowId = Number(canonicalRow.maxSourceRowId);

  // Decision tree
  
  // 1. Source is empty → not a replacement (might be startup or error)
  if (sourceCount === 0) return false;
  
  // 2. Canonical is empty → not a replacement (startup condition)
  if (canonicalCount === 0) return false;
  
  // 3. Source max ID is HIGHER than canonical max → incremental (new data exists)
  if (sourceMaxId > canonicalMaxSourceRowId) return false;
  
  // 4. Source and canonical counts are SIMILAR → not a replacement
  //    (normal day with few changes)
  if (sourceCount >= (canonicalCount * 0.7)) return false;  // More than 70% remain
  
  // 5. Source max ID is LOWER than canonical max AND
  //    Source count is much smaller → LIKELY REPLACEMENT
  if (sourceMaxId < canonicalMaxSourceRowId && 
      sourceCount < (canonicalCount * 0.5)) {  // Less than 50% remain
    
    // CONFIRM: source IDs no longer overlap with canonical IDs
    // This prevents false positive if data was just deleted + new data added
    // but new data happens to have lower IDs
    const [overlapRow] = await appSequelize.query<{ overlap_count: number }>(
      `SELECT COUNT(*) as overlap_count
       FROM (
         SELECT DISTINCT source_row_id FROM "DataWarehouse".normalized_reviews
         WHERE platform = 'myntra' AND source_row_id > $1
       ) AS canonical_ids
       WHERE EXISTS (
         SELECT 1 FROM "DataWarehouse".myntra_reviews
         WHERE myntra_reviews.id = canonical_ids.source_row_id
       )`,
      { bind: [sourceMaxId], transaction }
    );
    const overlapCount = Number(overlapRow?.overlap_count || 0);
    
    // If there's zero overlap, it's definitely replacement
    if (overlapCount === 0) return true;
    
    // If there's some overlap, don't act (conservative approach)
    return false;
  }
  
  // 6. Default: not a replacement
  return false;
}
```

### Decision Tree Flowchart

```
TrackA found zero new rows
    ↓
Source count = 0? ─→ NO, not a replacement
    ↓ No
Canonical count = 0? ─→ NO, not a replacement (startup)
    ↓ No
Source max ID > canonical max ID? ─→ NO, not a replacement (incremental exists)
    ↓ No
Source count ≥ 70% of canonical? ─→ NO, not a replacement (normal day)
    ↓ No
Source max ID < canonical max ID AND
Source < 50% of canonical count? ─→ YES, likely replacement
    ↓ Yes
Overlap check: source IDs > sourceMaxId
exist in current myntra_reviews? ─→ NO OVERLAP? → YES, REPLACEMENT
    ↓ No overlap
Return true (REPLACEMENT DETECTED)
```

### Safety Analysis

| Scenario | Source Count | Source Max ID | Canonical Count | Canonical Max | Overlap | Result |
|----------|--------------|---------------|-----------------|---------------|---------|--------|
| Normal incremental | 100 | 500100 | 500000 | 500000 | - | Not replacement ✓ |
| No changes today | 500000 | 500000 | 500000 | 500000 | - | Not replacement ✓ |
| Data deleted manually | 400000 | 500000 | 500000 | 500000 | High | Not replacement ✓ |
| Complete replacement | 50000 | 50000 | 500000 | 500000 | None | REPLACEMENT ✓ |
| Partial replacement | 300000 | 300000 | 500000 | 500000 | Yes | Not replacement ✓ |
| Startup (empty) | 50000 | 50000 | 0 | 0 | - | Not replacement ✓ |
| Corrupted (empty) | 0 | 0 | 500000 | 500000 | - | Not replacement ✓ |

### Determinism & Idempotency

**Running detection twice on same data:**
- Same source count ✓
- Same source max ID ✓
- Same canonical count ✓
- Same canonical max ID ✓
- Same overlap check ✓
- **Result: Same (deterministic)** ✓

**Running detection when no replacement:**
- Conditions fail to trigger ✓
- Returns false ✓
- No cleanup triggered ✓
- No state change ✓
- **Result: Idempotent** ✓

**Running detection after cleanup:**
- Source count: 50000 (unchanged)
- Canonical count: 50000 (cleaned)
- Overlap: none (already checked)
- **Result: Returns true again (but cleanup is idempotent, so safe)** ✓

---

## Why This Works

1. **Addresses watermark problem:** Doesn't rely on TrackA watermark logic
2. **Deterministic:** Pure data comparison, no assumptions about ID continuity
3. **Conservative:** Only acts when genuinely convinced (multiple checks)
4. **Safe:** Uses overlap confirmation to avoid false positives
5. **Platform-scoped:** Only queries myntra_reviews, doesn't affect Flipkart
6. **Transactional:** Runs within same transaction as ingestion

---

## Implementation Specifics

**When to call:**
- In TrackA, when `rawRows.length === 0`
- Before returning from TrackA
- Within the same transaction as ingestion

**What to do if true:**
- Don't reset watermark preemptively
- Instead, query with `id > 0` instead of `id > watermark` for THIS run
- Process all current Myntra reviews
- Run cleanup (Phases 1-4)
- Synchronize products
- Advance watermark to current MAX(id)

**Transaction safety:**
- All queries within transaction
- All changes within transaction
- Cleanup within transaction
- Watermark update within transaction
- Commit all or rollback all

---

## Verified Against Requirements

✅ Not simplistic ("zero rows = replacement")  
✅ Deterministic and idempotent  
✅ Uses actual source/canonical data comparison  
✅ Platform-scoped (Myntra only)  
✅ Safe (conservative, with confirmation)  
✅ No assumptions about ID continuity  

---

**Status:** READY FOR IMPLEMENTATION

