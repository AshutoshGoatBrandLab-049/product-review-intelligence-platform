# Milestone 2 End-to-End Verification Guide

**Objective:** Prove with actual running evidence that:

```
SOURCE DATA CHANGE
    ↓
DATABASE TRANSACTION
    ↓
COMMIT
    ↓
WEBSOCKET EVENT EMITTED
    ↓
REAL WEBSOCKET CLIENT RECEIVES EVENT
```

**Timeline:** 2026-08-20

---

## Prerequisites

### 1. Database Setup

Verify PostgreSQL is running:

```bash
psql -U postgres -h localhost -d gbl_data_lake -c "SELECT version();"
```

Expected: PostgreSQL version output

### 2. Environment Variables

Backend .env file at `/backend/.env` should have:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gbl_data_lake
DB_USER=postgres
DB_PASSWORD=1234
DB_SCHEMA=DataWarehouse
PORT=4000
NODE_ENV=development
```

### 3. Backend Build

Ensure TypeScript compiles:

```bash
cd backend
npm run build
```

Expected: 0 errors (warnings about unrelated tests OK)

---

## Verification Steps

### Phase 1: Start Backend Server

```bash
cd backend
npm run dev
```

Expected Output:
```
[timestamp] info: API server listening { port: 4000, nodeEnv: 'development' }
```

Keep this terminal running. Do NOT close it.

**Verify:** Try accessing the health endpoint:

```bash
curl http://localhost:4000/health
# or if health endpoint exists:
# Should return 200 OK or similar
```

---

### Phase 2: Start WebSocket Server (Separate Terminal)

The WebSocket server must run on a separate port (8080 or configurable).

Currently, the WebSocket server is NOT automatically started with the backend. 

**Option A: If WebSocket should be integrated into backend:**

Modify `backend/src/server.ts` to initialize and start the WebSocket server:

```typescript
import { appWebSocketServer } from "./modules/websocket/index.js";

export function startServer(): void {
  assertJwtSecretConfigured();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, "API server listening");
  });

  // Start WebSocket server alongside Express
  const WEBSOCKET_PORT = parseInt(process.env.WEBSOCKET_PORT || "8080", 10);
  appWebSocketServer.initialize(WEBSOCKET_PORT);
}
```

**Option B: Run WebSocket as separate process:**

Create `backend/src/runWebSocketServer.ts` and start it in a separate terminal:

```bash
npx tsx src/runWebSocketServer.ts
```

Expected Output:
```
[timestamp] info: WebSocket server initialized { port: 8080 }
```

**For this verification, use Option A** (integrate into backend) for simplicity.

---

### Phase 3: Create WebSocket Test Client

Create file: `backend/tests/e2e/websocket-test-client.ts`

```typescript
import WebSocket from "ws";

interface ReceivedEvent {
  type: string;
  platform: string;
  sourceProductId: string;
  changedAt: string;
  changes: { reviews: boolean; productDimension: boolean; dailyMetrics: boolean };
  receivedAt: string;
}

const client = new WebSocket("ws://localhost:8080");
const receivedEvents: ReceivedEvent[] = [];
let connectionTime = "";
let authTime = "";

client.onopen = () => {
  connectionTime = new Date().toISOString();
  console.log(`[${connectionTime}] Connected to WebSocket`);

  // Authenticate
  client.send(JSON.stringify({ type: "AUTHENTICATE", userId: "e2e-test-user" }));
  authTime = new Date().toISOString();
  console.log(`[${authTime}] Sent authentication`);
};

client.onmessage = (event: MessageEvent) => {
  const data = JSON.parse(event.data as string);
  const receivedAt = new Date().toISOString();

  if (data.event?.type === "PRODUCT_DATA_UPDATED") {
    console.log(`[${receivedAt}] Received PRODUCT_DATA_UPDATED:`, data.event);
    receivedEvents.push({
      ...data.event,
      receivedAt,
    });
  }
};

client.onerror = (error: Event) => {
  console.error(`[${new Date().toISOString()}] WebSocket error:`, error);
};

// Keep alive for 120 seconds, then report
setTimeout(() => {
  console.log("\n═══════════════════════════════════════════");
  console.log("WEBSOCKET TEST CLIENT - FINAL REPORT");
  console.log("═══════════════════════════════════════════");
  console.log(`Connected at: ${connectionTime}`);
  console.log(`Authenticated at: ${authTime}`);
  console.log(`Events received: ${receivedEvents.length}`);
  console.log("\nEvents:");
  for (const event of receivedEvents) {
    console.log(`  - ${event.platform}:${event.sourceProductId}`);
    console.log(`    Emitted: ${event.changedAt}`);
    console.log(`    Received: ${event.receivedAt}`);
    console.log(`    Changes: ${JSON.stringify(event.changes)}`);
  }
  console.log("═══════════════════════════════════════════\n");

  client.close();
  process.exit(0);
}, 120000);
```

---

### Phase 4: Run WebSocket Client (Third Terminal)

```bash
cd backend
npx tsx tests/e2e/websocket-test-client.ts
```

Expected Output:
```
[2026-08-20T11:40:30.123Z] Connected to WebSocket
[2026-08-20T11:40:30.456Z] Sent authentication
```

Keep this running while you execute ingestion.

---

### Phase 5: Run Flipkart Ingestion (Fourth Terminal)

While both WebSocket client and backend are running:

```bash
cd backend
npm run ingest:flipkart 2>&1 | tee flipkart-ingestion.log
```

Capture Output:
```bash
cp flipkart-ingestion.log ../docs/milestone2-flipkart-ingestion.log
```

**Expected Sequence in Logs:**

1. Track A starts
2. Reviews inserted
3. Watermark advanced
4. Transaction commits
5. WebSocket events emitted
6. Track B starts
7. Reviews synchronized
8. Events emitted (if any updates found)

---

### Phase 6: Verify WebSocket Client Received Events

In the WebSocket client terminal (Phase 4), you should see:

```
[2026-08-20T11:40:45.789Z] Received PRODUCT_DATA_UPDATED:
{
  type: 'PRODUCT_DATA_UPDATED',
  platform: 'flipkart',
  sourceProductId: 'PROD-12345',
  changedAt: '2026-08-20T11:40:45.345Z',
  changes: { reviews: true, productDimension: true, dailyMetrics: true },
  receivedAt: '2026-08-20T11:40:45.789Z'
}
```

**Record:**
- Time of first event emission
- Time of client reception
- Number of unique products
- Verify `changedAt <= receivedAt`

---

### Phase 7: Verify Database State

In a new terminal:

```bash
psql -U postgres -h localhost -d gbl_data_lake << 'EOF'

-- Count normalized reviews
SELECT COUNT(*) as normalized_count FROM "DataWarehouse".normalized_reviews;

-- Check product_dimension was synchronized
SELECT COUNT(*) as product_dim_count FROM "DataWarehouse".product_dimension
WHERE last_rebuilt_at > now() - interval '10 minutes';

-- Check product_daily_metrics was synchronized
SELECT COUNT(*) as daily_metrics_count FROM "DataWarehouse".product_daily_metrics
WHERE last_rebuilt_at > now() - interval '10 minutes';

-- Sample a synchronized product
SELECT 
  platform, source_product_id, total_review_count, last_rebuilt_at
FROM "DataWarehouse".product_dimension
WHERE last_rebuilt_at > now() - interval '10 minutes'
LIMIT 5;

EOF
```

Expected:
- `normalized_count` increased
- `product_dim_count` > 0
- `daily_metrics_count` > 0
- `last_rebuilt_at` timestamps are recent

---

### Phase 8: Run Myntra Ingestion (Same Fourth Terminal)

After Flipkart completes:

```bash
npm run ingest:myntra 2>&1 | tee myntra-ingestion.log
```

Capture Output:
```bash
cp myntra-ingestion.log ../docs/milestone2-myntra-ingestion.log
```

**Verify:** Same sequence as Flipkart, but for Myntra platform.

---

### Phase 9: Test Deduplication

Review the WebSocket client output. If 5 reviews were for the same product:

```
Expected:
  1 event for that product
  
NOT:
  5 events for the same product
```

Count unique products in events:

```bash
# From WebSocket client output
events_per_product="
[look at received events section]
- Count unique sourceProductId values
- Should be <= number of reviews
"
```

---

### Phase 10: Verify No Regressions (Run Full Test Suite)

```bash
cd backend
npm test 2>&1 | tee test-results.log

# Capture summary
tail -30 test-results.log
```

Expected:
```
Test Files  39 passed (same as before)
Tests  350 passed (same as before)
```

**Critical:** If any previously passing test now fails, it's a regression.

---

## Evidence Collection Checklist

Create a file: `docs/milestone2-e2e-evidence.md` with:

### A. Environment
- [ ] PostgreSQL version
- [ ] Backend port confirmed
- [ ] WebSocket port confirmed
- [ ] Database size before/after

### B. Flipkart E2E Timestamps
```
BEGIN: [timestamp from log]
SYNC product_dimension: [timestamp from code]
SYNC product_daily_metrics: [timestamp from code]
COMMIT: [timestamp from log]
EVENT EMITTED: [timestamp from log]
EVENT RECEIVED by client: [timestamp from WebSocket client]
```

### C. Myntra E2E Timestamps
Same as B

### D. Deduplication Proof
```
Reviews inserted: [count]
Products affected: [count]
WebSocket events emitted: [count]
Proof: events count == unique products count
```

### E. Event Payload (Actual)
```json
{
  "type": "PRODUCT_DATA_UPDATED",
  "platform": "flipkart",
  "sourceProductId": "ACTUAL_ID_HERE",
  "changedAt": "2026-08-20T11:40:45.123Z",
  "changes": {
    "reviews": true,
    "productDimension": true,
    "dailyMetrics": true
  },
  "receivedAt": "2026-08-20T11:40:45.456Z"
}
```

### F. Database Integrity
```
normalized_reviews inserted: [count]
product_dimension synchronized: [count]
product_daily_metrics synchronized: [count]
All lastRebuiltAt >= transaction commit time: YES/NO
```

### G. Test Results
```
Test Files:  39 passed, 31 failed (same as baseline)
Tests: 350 passed (same as baseline)
No new regressions: YES/NO
```

---

## Rollback Testing (Optional but Recommended)

### Force a Database Failure

Modify `backend/src/modules/analytics/synchronize.ts` temporarily:

```typescript
export async function synchronizeProductDailyMetrics(...): Promise<void> {
  if (products.length > 2) {
    throw new Error("FORCED TEST FAILURE");
  }
  // ... rest of function
}
```

### Run Ingestion Again

```bash
npm run ingest:flipkart
```

### Expected Result
- Database transaction rolls back
- No new normalized_reviews
- No product_dimension changes
- No product_daily_metrics changes
- **No WebSocket event emitted**
- Ingestion reports failure

### Restore Code

Remove the forced failure and rebuild:

```bash
git checkout src/modules/analytics/synchronize.ts
npm run build
```

---

## Final Verification Summary

When all tests complete, answer:

1. **Commit Before Event?** YES/NO + Timestamps
2. **Events Received?** YES/NO + Count
3. **Deduplication Works?** YES/NO + Evidence
4. **Database Synced?** YES/NO + Row counts
5. **No Regressions?** YES/NO + Test counts
6. **Rollback Works?** YES/NO + DB state
7. **WebSocket Reliable?** YES/NO + Errors

**If ALL YES: MILESTONE 2 VERIFIED — READY FOR MILESTONE 3**

**If ANY NO: Document what failed and remediate before proceeding.**

---

## Cleanup

Remove test logs:

```bash
rm -f flipkart-ingestion.log myntra-ingestion.log test-results.log
```

Restore database to pre-test state if needed:

```bash
# If test data was inserted:
DELETE FROM "DataWarehouse".normalized_reviews WHERE created_at > NOW() - interval '1 hour';
DELETE FROM "DataWarehouse".product_dimension WHERE last_rebuilt_at > NOW() - interval '1 hour';
DELETE FROM "DataWarehouse".product_daily_metrics WHERE last_rebuilt_at > NOW() - interval '1 hour';
```

---

## Next Steps

Once end-to-end verification is complete and all tests pass:

1. Update CLAUDE.md with Milestone 2 completion status
2. Save actual evidence files to `docs/milestone2-e2e-evidence.md`
3. Archive ingestion logs to `docs/milestone2-ingestion-logs/`
4. Proceed to Milestone 3 (Frontend Integration)

---

**Document Created:** 2026-08-20  
**Status:** Ready for Manual Verification  
**Estimated Time:** 30-45 minutes for full verification
