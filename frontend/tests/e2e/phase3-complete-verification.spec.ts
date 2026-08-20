import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const evidenceDir = path.join(__dirname, '../../phase3-complete-evidence');

if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test('Phase 3 Complete Verification: Full WebSocket Flow with Evidence', async ({ browser, context }) => {
  console.log('\n╔═════════════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 3 COMPLETE VERIFICATION - FULL WEBSOCKET FLOW E2E TEST    ║');
  console.log('║  Real Browser + WebSocket Monitoring + Network Capture           ║');
  console.log('╚═════════════════════════════════════════════════════════════════╝\n');

  // ============================================
  // STEP 0: Prepare Clean Source Data & Reset Watermark
  // ============================================
  console.log('📋 STEP 0: Preparing source database and resetting ingestion watermark...\n');

  const sourceDataBefore = await new Promise<string>((resolve) => {
    const psql = spawn('bash', [
      '-c',
      `PGPASSWORD=1234 psql -U postgres -d gbl_data_lake -h localhost << 'EOSQL'
SET search_path TO "DataWarehouse";

-- Clean up old test data
DELETE FROM myntra_reviews WHERE product_id = 100;

-- Reset watermark to allow ingestion of new test data
UPDATE ingestion_watermarks SET last_seen_source_id = 51200 WHERE platform = 'myntra';

-- Verify state
SELECT 'Current watermark for myntra: ' || last_seen_source_id::text FROM ingestion_watermarks WHERE platform = 'myntra';
SELECT 'Test data in myntra_reviews: ' || COUNT(*)::text FROM myntra_reviews WHERE product_id = 100;
EOSQL`
    ]);

    let output = '';
    psql.stdout.on('data', (data) => { output += data.toString(); });
    psql.on('close', () => resolve(output));
  });

  console.log('Source data BEFORE state:');
  console.log(sourceDataBefore);
  fs.writeFileSync(path.join(evidenceDir, '00-source-before.txt'), sourceDataBefore);

  // ============================================
  // STEP 1: Open Browser and Verify WebSocket
  // ============================================
  console.log('\n🌐 STEP 1: Opening browser and verifying WebSocket connection...\n');

  const page = await context.newPage();

  // Record WebSocket messages
  const wsMessages: any[] = [];
  const apiCalls: any[] = [];
  let wsConnected = false;

  page.on('websocket', (ws) => {
    console.log('✅ WebSocket connection detected');
    wsConnected = true;

    ws.on('framereceived', (event) => {
      try {
        const data = JSON.parse(event.payload.toString());
        wsMessages.push({
          timestamp: new Date().toISOString(),
          type: data.event?.type,
          payload: data
        });
        console.log(`📡 WebSocket frame received: ${data.event?.type}`);
      } catch (e) {}
    });
  });

  // Record API calls
  page.on('response', (response) => {
    if (response.url().includes('/api/reviews')) {
      apiCalls.push({
        url: response.url().split('?')[0],
        status: response.status(),
        timestamp: new Date().toISOString(),
      });
      console.log(`📡 API call: ${response.status()} ${response.url().split('?')[0]}`);
    }
  });

  // Navigate to ProductRankingList
  console.log('📍 Navigating to ProductRankingList (myntra/negative)...');
  await page.goto('http://localhost:5173/reviews-overview/myntra/negative', {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForTimeout(3000);

  const initialUrl = page.url();
  const initialScrollY = await page.evaluate(() => window.scrollY);

  console.log(`✅ Loaded: ${initialUrl}`);
  console.log(`✅ Scroll: ${initialScrollY}`);
  console.log(`✅ WebSocket: ${wsConnected ? 'Connected' : 'Not connected yet'}`);

  // Screenshot BEFORE
  await page.screenshot({ path: path.join(evidenceDir, '01-before-websocket.png') });
  console.log('📸 Screenshot: Before ingestion\n');

  // ============================================
  // STEP 2: Insert Source Data
  // ============================================
  console.log('💾 STEP 2: Inserting new source data into myntra_reviews...\n');

  const insertResult = await new Promise<string>((resolve) => {
    const psql = spawn('bash', [
      '-c',
      `PGPASSWORD=1234 psql -U postgres -d gbl_data_lake -h localhost << 'EOSQL'
SET search_path TO "DataWarehouse";

-- Insert 50 test reviews for product 100 (will appear in myntra/negative)
INSERT INTO myntra_reviews (
  product_id, brand_name, review_id, rating, title, body,
  review_date, reviewed_at, author_name, helpful_count, not_helpful_count,
  has_images, country, "createdAt", "updatedAt"
)
SELECT
  100 as product_id,
  'Phase3Test' as brand_name,
  'phase3_test_' || ROW_NUMBER() OVER () as review_id,
  1 as rating,  -- Negative rating (1 star)
  'Phase 3 Test ' || ROW_NUMBER() OVER () as title,
  'Phase 3 verification test review ' || ROW_NUMBER() OVER () as body,
  (NOW()::date - ((ROW_NUMBER() OVER () % 5) || ' days')::interval)::date as review_date,
  NOW() - ((ROW_NUMBER() OVER () % 5) || ' days')::interval as reviewed_at,
  'phase3_user_' || ROW_NUMBER() OVER () as author_name,
  (ROW_NUMBER() OVER () % 3) as helpful_count,
  (ROW_NUMBER() OVER () % 2) as not_helpful_count,
  false as has_images,
  'India' as country,
  NOW() as "createdAt",
  NOW() as "updatedAt"
FROM generate_series(1, 50);

-- Verify insertion
SELECT COUNT(*) as newly_inserted FROM myntra_reviews WHERE product_id = 100 AND review_id LIKE 'phase3_test_%';
EOSQL`
    ]);

    let output = '';
    psql.stdout.on('data', (data) => { output += data.toString(); });
    psql.on('close', () => resolve(output));
  });

  console.log('Source data insertion result:');
  console.log(insertResult);
  fs.writeFileSync(path.join(evidenceDir, '02-insert-result.txt'), insertResult);

  // ============================================
  // STEP 3: Run Ingestion While Monitoring
  // ============================================
  console.log('\n⚙️  STEP 3: Running ingestion while monitoring WebSocket...\n');

  const beforeWSCount = wsMessages.length;
  const beforeAPICount = apiCalls.length;

  const ingestionLog = await new Promise<string>((resolve) => {
    const ingest = spawn('npm', ['run', 'ingest:myntra'], {
      cwd: path.join(__dirname, '../../..', 'backend'),
      shell: true,
    });

    let output = '';
    const startTime = Date.now();

    ingest.stdout.on('data', (data) => {
      output += data.toString();
      const text = data.toString();
      if (text.includes('rowsInserted')) console.log(`   ${text.split('\n')[0]}`);
    });

    ingest.on('close', () => {
      const duration = Date.now() - startTime;
      console.log(`✅ Ingestion completed in ${duration}ms\n`);
      resolve(output);
    });
  });

  fs.writeFileSync(path.join(evidenceDir, '03-ingestion.log'), ingestionLog);

  // Wait for any pending WebSocket/API events
  console.log('⏳ Waiting for WebSocket events and API calls...');
  await page.waitForTimeout(3000);

  const afterWSCount = wsMessages.length;
  const afterAPICount = apiCalls.length;

  console.log(`\nWebSocket frames:    ${beforeWSCount} → ${afterWSCount} (${afterWSCount - beforeWSCount} new)`);
  console.log(`API calls:           ${beforeAPICount} → ${afterAPICount} (${afterAPICount - beforeAPICount} new)\n`);

  // ============================================
  // STEP 4: Capture Evidence
  // ============================================
  console.log('📸 STEP 4: Capturing evidence...\n');

  // Screenshot AFTER
  await page.screenshot({ path: path.join(evidenceDir, '04-after-ingestion.png') });
  console.log('📸 Screenshot: After ingestion');

  // Final URL and scroll
  const finalUrl = page.url();
  const finalScrollY = await page.evaluate(() => window.scrollY);

  console.log(`✅ Final URL: ${finalUrl}`);
  console.log(`✅ Final Scroll: ${finalScrollY}`);
  console.log(`✅ URL preserved: ${initialUrl === finalUrl}`);
  console.log(`✅ Scroll preserved: ${Math.abs(initialScrollY - finalScrollY) < 100}`);

  // ============================================
  // STEP 5: Verify Source Data After
  // ============================================
  console.log('\n📊 STEP 5: Verifying database state after ingestion...\n');

  const sourceDataAfter = await new Promise<string>((resolve) => {
    const psql = spawn('bash', [
      '-c',
      `PGPASSWORD=1234 psql -U postgres -d gbl_data_lake -h localhost << 'EOSQL'
SET search_path TO "DataWarehouse";

-- Check normalized_reviews
SELECT platform, source_product_id, COUNT(*) as normalized_count
FROM normalized_reviews
WHERE platform = 'myntra' AND source_product_id = '100'
GROUP BY platform, source_product_id;

-- Check if ingestion marked data as processed
SELECT MAX(source_row_id) as last_processed_id FROM normalized_reviews WHERE platform = 'myntra';

-- Verify original source data still exists
SELECT COUNT(*) as source_remaining FROM myntra_reviews WHERE product_id = 100;
EOSQL`
    ]);

    let output = '';
    psql.stdout.on('data', (data) => { output += data.toString(); });
    psql.on('close', () => resolve(output));
  });

  console.log('Database state after ingestion:');
  console.log(sourceDataAfter);
  fs.writeFileSync(path.join(evidenceDir, '05-database-after.txt'), sourceDataAfter);

  // ============================================
  // STEP 6: Print Results
  // ============================================
  console.log('\n╔═════════════════════════════════════════════════════════════════╗');
  console.log('║                      VERIFICATION RESULTS                        ║');
  console.log('╚═════════════════════════════════════════════════════════════════╝\n');

  const wsEventDetected = wsMessages.some(msg => msg.type === 'PRODUCT_DATA_UPDATED');
  const apiRefreshDetected = afterAPICount > beforeAPICount;
  const noPageReload = initialUrl === finalUrl;
  const scrollPreserved = Math.abs(initialScrollY - finalScrollY) < 100;
  const dataInserted = insertResult.includes('newly_inserted');

  console.log('Test Evidence:');
  console.log(`✅ Source data inserted: ${dataInserted ? 'YES' : 'NO'}`);
  console.log(`${wsEventDetected ? '✅' : '❌'} WebSocket PRODUCT_DATA_UPDATED received: ${wsEventDetected ? 'YES' : 'NO'}`);
  console.log(`${apiRefreshDetected ? '✅' : '❌'} API refresh detected: ${apiRefreshDetected ? 'YES' : 'NO'}`);
  console.log(`✅ No page reload: ${noPageReload ? 'YES' : 'NO'}`);
  console.log(`✅ Scroll preserved: ${scrollPreserved ? 'YES' : 'NO'}`);

  // ============================================
  // STEP 7: Save Evidence Summary
  // ============================================
  const evidenceSummary = {
    timestamp: new Date().toISOString(),
    test: 'Phase 3 Complete Verification',
    testResults: {
      sourceDataInserted: dataInserted,
      wsEventReceived: wsEventDetected,
      apiRefreshDetected: apiRefreshDetected,
      noPageReload: noPageReload,
      scrollPreserved: scrollPreserved,
    },
    wsMessages: wsMessages.map(m => ({ timestamp: m.timestamp, type: m.type })),
    apiCalls: apiCalls.map(c => ({ timestamp: c.timestamp, url: c.url, status: c.status })),
    statePreservation: {
      initialUrl,
      finalUrl,
      urlPreserved: noPageReload,
      initialScrollY,
      finalScrollY,
      scrollPreserved,
    },
    filesGenerated: [
      '00-source-before.txt',
      '01-before-websocket.png',
      '02-insert-result.txt',
      '03-ingestion.log',
      '04-after-ingestion.png',
      '05-database-after.txt',
      '06-evidence-summary.json'
    ]
  };

  fs.writeFileSync(
    path.join(evidenceDir, '06-evidence-summary.json'),
    JSON.stringify(evidenceSummary, null, 2)
  );

  console.log('\n📁 Evidence files generated:');
  console.log(`   Directory: ${evidenceDir}`);
  evidenceSummary.filesGenerated.forEach(f => console.log(`   - ${f}`));

  // ============================================
  // STEP 8: Assertions
  // ============================================
  console.log('\n🔍 Final Assertions:\n');

  expect(dataInserted).toBe(true);  // Source data must be inserted
  expect(noPageReload).toBe(true);  // URL must not change
  expect(scrollPreserved).toBe(true); // Scroll must be preserved

  // These are the critical tests that prove the complete flow
  expect(wsEventDetected).toBe(true);  // WebSocket event MUST be received
  expect(apiRefreshDetected).toBe(true); // API MUST be called after event

  console.log('✅ All critical assertions passed!\n');

  await page.close();

  console.log('╔═════════════════════════════════════════════════════════════════╗');
  console.log('║                    VERIFICATION COMPLETE ✅                      ║');
  console.log('╚═════════════════════════════════════════════════════════════════╝\n');
});
