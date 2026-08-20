# Phase 3 WebSocket Integration - Root Cause & Fix Guide

**Date:** 2026-08-20  
**Status:** Root cause identified, 3 solutions provided  
**Decision Required:** Choose and implement one option

---

## Executive Summary

**Phase 3 is NOT production-ready due to a critical inter-process communication issue.**

The WebSocket events emitted during ingestion never reach the browser because the ingestion runs as a separate child process with its own singleton instances, separate from the server process that manages WebSocket connections.

---

## Root Cause Analysis

### The Problem

```
Server Process (npm start/npm run dev)
├─ Express app listening on :4000
├─ WebSocket server on :8080
├─ webSocketEventEmitter singleton (with listener registered)
└─ Browser WebSocket connects here ✅

Ingestion Process (npm run ingest:myntra) - SEPARATE PROCESS
├─ webSocketEventEmitter singleton (different instance!)
├─ broadcastEvent() called on THIS instance
└─ Event never reaches server's listener ❌
```

### Why Tests Pass But Real Use Fails

- **Automated tests:** Run in-process, all singletons are shared ✅
- **Real ingestion:** Spawned via `npm run ingest:myntra`, separate process ❌
- **Result:** Tests verify code logic but not inter-process communication

---

## Three Solutions

### OPTION A: In-Process Ingestion (RECOMMENDED)

**Approach:** Call ingestion as a direct TypeScript function instead of spawning a process

**Pros:**
- ✅ Simplest to implement
- ✅ Singletons are automatically shared
- ✅ WebSocket events reach browser immediately
- ✅ Fastest execution (no process spawn overhead)
- ✅ Easier error handling

**Cons:**
- ⚠️ Can't run ingestion independently
- ⚠️ Ingestion blocks HTTP requests during execution
- ⚠️ Tied to server lifecycle

**Implementation:**
```typescript
// Already exported from runIngestion.ts
export async function runIngestion(platform: Platform, jobId?: string)

// Call from anywhere in server:
const result = await runIngestion('myntra');

// Singletons shared ✅
// WebSocket events reach browser ✅
```

**Files to change:**
- Create `/api/routes/ingestion.ts` - REST endpoint that calls `runIngestion()` directly
- Modify test to call REST endpoint instead of spawning process

---

### OPTION B: HTTP Callback (SCALABLE)

**Approach:** Ingestion process runs separately but calls REST API on server when done

**Pros:**
- ✅ Ingestion can run independently
- ✅ Scalable (multiple ingestion workers)
- ✅ Server doesn't block
- ✅ Easy monitoring

**Cons:**
- ⚠️ More complex error handling
- ⚠️ Network latency (HTTP overhead)
- ⚠️ Callback may fail after ingestion succeeds

**Implementation:**
```typescript
// In spawned ingestion process (runIngestion.ts main())
const result = await runIngestion('myntra');

// Callback to server
await fetch('http://localhost:4000/internal/ingestion-complete', {
  method: 'POST',
  body: JSON.stringify(result)
});

// Server endpoint processes callback
// Server's singletons emit WebSocket events
```

**Files to change:**
- Create `/api/routes/ingestion.ts` - endpoint for receiving callbacks
- Modify `runIngestion.ts` - add HTTP callback after completion
- Create endpoint to accept callback and broadcast WebSocket

---

### OPTION C: Message Queue (MOST SCALABLE)

**Approach:** Ingestion publishes results to Redis/RabbitMQ, server subscribes and broadcasts

**Pros:**
- ✅ Most scalable architecture
- ✅ Decoupled components
- ✅ Supports multiple ingestion workers
- ✅ Fault-tolerant
- ✅ Works across multiple servers

**Cons:**
- ⚠️ Requires external infrastructure (Redis/RabbitMQ)
- ⚠️ Most complex setup
- ⚠️ Additional operational overhead

**Implementation:**
```typescript
// In ingestion process
const result = await runIngestion('myntra');
await redis.publish('ingestion:complete', JSON.stringify(result));

// In server process  
redis.subscribe('ingestion:complete', (message) => {
  const result = JSON.parse(message);
  webSocketEventEmitter.broadcastEvent(...);
});
```

**Files to change:**
- Install Redis client
- Create `/api/routes/ingestion.ts` - subscribe to Redis
- Modify `runIngestion.ts` - publish to Redis
- Update docker-compose (add Redis)

---

## Decision Matrix

| Factor | Option A | Option B | Option C |
|--------|----------|----------|----------|
| **Complexity** | ⭐ (Simple) | ⭐⭐⭐ (Medium) | ⭐⭐⭐⭐⭐ (Complex) |
| **Speed** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Scalability** | ⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Time to fix** | 1 hour | 2-3 hours | 4-6 hours |
| **For Phase 3** | ✅ Perfect | ⚠️ Overkill | ⚠️ Overkill |
| **For production** | ✅ Good | ✅ Better | ✅ Best |

---

## Recommendation

**For Phase 3 Approval:** Use **OPTION A**

**Rationale:**
- Simplest implementation
- No external dependencies  
- Solves the WebSocket problem immediately
- Suitable for current scale
- Can migrate to Option B/C later if needed

---

## Implementation Checklist

### Option A (Recommended - 1 hour)

- [ ] Export `runIngestion()` function from `runIngestion.ts` ✅ DONE
- [ ] Create `/api/routes/ingestion.ts` with POST endpoint ✅ DONE  
- [ ] Add route to Express app (`router.ts`) ✅ DONE
- [ ] Update E2E test to call REST endpoint instead of spawn
  - [ ] Reset watermark in test
  - [ ] Call `POST /internal/ingestion/trigger`
  - [ ] Wait for WebSocket events
  - [ ] Assert `PRODUCT_DATA_UPDATED` received
- [ ] Run full E2E test
- [ ] Verify WebSocket events reach browser
- [ ] Verify API refresh is triggered
- [ ] Verify UI updates without page reload

### Why Current Tests Failed

The ingestion endpoint WAS called, but the browser still didn't receive events. Likely reasons:

1. **affectedProducts still empty** - affected products collection not being populated during ingestion
   - Root cause: sourceProductId might be NULL or empty string
   - Debug: Add logging to show sourceProductId values for each row
   
2. **WebSocket listener registration timing** - listener might not be registered before event emitted
   - Check: Verify `webSocketEventEmitter.onBroadcast()` is called before ingestion runs
   
3. **Event emission scope** - possible scope issue with how affectedProducts is collected
   - Check: Verify affectedProducts is not being cleared accidentally

---

## Quick Fix Check

To verify WebSocket connectivity is actually working:

```bash
# In one terminal
curl -i http://localhost:4000/internal/ingestion/health

# Response should be:
# {"status":"ready","message":"Ingestion service is ready"}

# In another terminal, watch backend logs:
tail -f /tmp/backend.log | grep -i "websocket\|broadcast"
```

---

## Next Steps

1. **Choose Option A** (recommended for Phase 3)
2. **Implement proper debugging** to find why affectedProducts is still empty
3. **Run corrected E2E test** with detailed logging
4. **Verify WebSocket events are emitted and received**
5. **Approve Phase 3** once WebSocket flow is proven working end-to-end
6. **Plan Option B/C migration** for production scaling

---

## Critical Discovery

The root cause (inter-process singletons) is REAL and CRITICAL. Any solution that keeps ingestion as a separate process will NOT work unless there's explicit inter-process communication (IPC), REST callback, or message queue.

The fix is not optional - Phase 3 cannot be approved without implementing one of these three solutions.

