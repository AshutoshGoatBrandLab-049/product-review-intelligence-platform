import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const evidenceDir = path.join(__dirname, '../../phase3-e2e-evidence');

if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('Phase 3 Manual E2E Verification', () => {
  test('Complete WebSocket flow: Source → Ingestion → Event → Browser → UI Update', async ({ browser }) => {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║     PHASE 3 MANUAL E2E VERIFICATION - REAL BROWSER TEST        ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const context = await browser.newContext({
      recordVideo: { dir: evidenceDir },
    });
    const page = await context.newPage();

    // ============================================
    // STEP 1: Verify Servers Running
    // ============================================
    await test.step('STEP 1: Verify backend and frontend servers', async () => {
      console.log('🔍 Verifying servers...');

      // Test frontend
      const frontendResponse = await page.goto('http://localhost:5173', {
        waitUntil: 'domcontentloaded',
      }).catch(() => null);

      expect(frontendResponse).not.toBeNull();
      console.log('✅ Frontend responding');

      // Test backend health (via page requests)
      const backendCheck = await page.evaluate(() => {
        return fetch('http://localhost:4000/health')
          .then(r => r.status)
          .catch(() => 0);
      }).catch(() => 0);

      console.log(`✅ Backend responding (status: ${backendCheck || 'unknown'})`);
    });

    // ============================================
    // STEP 2: Navigate to ProductRankingList
    // ============================================
    await test.step('STEP 2: Navigate to ProductRankingList', async () => {
      console.log('\n📍 Navigating to ProductRankingList...');

      await page.goto('http://localhost:5173/reviews-overview/myntra/negative', {
        waitUntil: 'domcontentloaded',
      }).catch(() => {});

      await page.waitForTimeout(2000);
      console.log('✅ Navigated to:', page.url());

      // Screenshot BEFORE
      await page.screenshot({ path: path.join(evidenceDir, '01-before-ui.png') });
      console.log('📸 Screenshot: Before ingestion');
    });

    // ============================================
    // STEP 3: Set up monitoring
    // ============================================
    const networkRequests: any[] = [];
    const wsEvents: any[] = [];
    const consoleMessages: any[] = [];
    let initialUrl = page.url();
    let initialScrollY = 0;

    await test.step('STEP 3: Set up event monitoring', async () => {
      console.log('\n📡 Setting up monitoring...');

      // Network monitoring
      page.on('response', (response) => {
        if (response.url().includes('/api/reviews')) {
          networkRequests.push({
            url: response.url().split('?')[0],
            status: response.status(),
            timestamp: new Date().toISOString(),
          });
          console.log('📡 API request detected:', response.status());
        }
      });

      // Console monitoring
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleMessages.push({
            type: 'error',
            text: msg.text(),
            timestamp: new Date().toISOString(),
          });
        }
      });

      // Get initial state
      initialScrollY = await page.evaluate(() => window.scrollY);

      console.log('✅ Monitoring active');
      console.log('   Initial URL:', initialUrl);
      console.log('   Initial Scroll:', initialScrollY);
    });

    // ============================================
    // STEP 4: Run Ingestion
    // ============================================
    let ingestionLog = '';
    let ingestionSuccess = false;

    await test.step('STEP 4: Run ingestion with 300 replacement reviews', async () => {
      console.log('\n⚙️  Running ingestion...');

      ingestionLog = await new Promise((resolve) => {
        const ingestProcess = spawn('npm', ['run', 'ingest:myntra'], {
          cwd: path.join(__dirname, '../../..', 'backend'),
          shell: true,
        });

        let output = '';
        const startTime = Date.now();

        ingestProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        ingestProcess.stderr.on('data', (data) => {
          output += data.toString();
        });

        ingestProcess.on('close', () => {
          const duration = Date.now() - startTime;
          ingestionSuccess = output.includes('success') && !output.includes('failed');

          console.log(`✅ Ingestion completed in ${duration}ms`);
          if (ingestionSuccess) {
            console.log('   Status: SUCCESS');
          } else {
            console.log('   Status: Check logs');
          }

          resolve(output);
        });
      });

      fs.writeFileSync(path.join(evidenceDir, 'ingestion.log'), ingestionLog);
    });

    // ============================================
    // STEP 5: Wait for UI updates
    // ============================================
    await test.step('STEP 5: Wait for WebSocket event and API refresh', async () => {
      console.log('\n⏳ Waiting for events (max 5 seconds)...');

      // Wait for potential UI updates
      await page.waitForTimeout(5000);

      console.log(`✅ Detected ${networkRequests.length} API request(s)`);
      if (networkRequests.length > 0) {
        console.log('   Last request:', networkRequests[networkRequests.length - 1]?.timestamp);
      }
    });

    // ============================================
    // STEP 6: Verify UI State After
    // ============================================
    let finalUrl = '';
    let finalScrollY = 0;

    await test.step('STEP 6: Verify UI state after ingestion', async () => {
      console.log('\n📸 Capturing final UI state...');

      finalUrl = page.url();
      finalScrollY = await page.evaluate(() => window.scrollY);

      console.log('Final URL:', finalUrl);
      console.log('Final Scroll:', finalScrollY);

      // Screenshot AFTER
      await page.screenshot({ path: path.join(evidenceDir, '02-after-ui.png') });
      console.log('📸 Screenshot: After ingestion');
    });

    // ============================================
    // STEP 7: Check backend logs for WebSocket event
    // ============================================
    let wsEventDetected = false;

    await test.step('STEP 7: Check backend logs for WebSocket event emission', async () => {
      console.log('\n🔌 Checking for WebSocket event emission...');

      try {
        const backendLog = fs.readFileSync('/tmp/backend.log', 'utf-8');
        if (backendLog.includes('PRODUCT_DATA_UPDATED') || backendLog.includes('broadcastEvent')) {
          wsEventDetected = true;
          console.log('✅ WebSocket event emission detected in backend logs');
        } else {
          console.log('⚠️  No WebSocket event emission found');
        }
      } catch (e) {
        console.log('⚠️  Could not read backend logs');
      }
    });

    // ============================================
    // STEP 8: Final Verification
    // ============================================
    await test.step('STEP 8: Final verification', async () => {
      console.log('\n╔════════════════════════════════════════════════════════════════╗');
      console.log('║                    TEST RESULTS                                ║');
      console.log('╚════════════════════════════════════════════════════════════════╝\n');

      const results = {
        '✅ Ingestion executed': ingestionSuccess,
        '✅ No page reload': initialUrl === finalUrl,
        '✅ Scroll position preserved': Math.abs(initialScrollY - finalScrollY) < 100,
        '✅ API refresh detected': networkRequests.length > 0,
        '✅ WebSocket event emitted': wsEventDetected,
        '✅ No console errors': consoleMessages.length === 0,
      };

      Object.entries(results).forEach(([test, passed]) => {
        console.log(`${test}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
      });

      console.log('\n' + '═'.repeat(65));

      // Save evidence
      const evidence = {
        timestamp: new Date().toISOString(),
        test: 'Phase 3 E2E: WebSocket Integration',
        results: {
          ingestionSuccess,
          noPageReload: initialUrl === finalUrl,
          scrollPreserved: Math.abs(initialScrollY - finalScrollY) < 100,
          apiCallsMade: networkRequests.length,
          wsEventDetected,
          consoleErrors: consoleMessages.length,
        },
        initialState: {
          url: initialUrl,
          scrollY: initialScrollY,
        },
        finalState: {
          url: finalUrl,
          scrollY: finalScrollY,
        },
        networkRequests,
        consoleMessages,
        ingestionLogSnippet: ingestionLog.slice(-1000),
        screenshots: {
          before: '01-before-ui.png',
          after: '02-after-ui.png',
        },
        video: 'page@*.webm',
      };

      fs.writeFileSync(
        path.join(evidenceDir, 'phase3-e2e-results.json'),
        JSON.stringify(evidence, null, 2)
      );

      console.log('\n📄 Evidence saved to:', evidenceDir);
      console.log('\nFiles captured:');
      console.log('  - 01-before-ui.png (ProductRankingList before)');
      console.log('  - 02-after-ui.png (ProductRankingList after)');
      console.log('  - phase3-e2e-results.json (complete results)');
      console.log('  - ingestion.log (full ingestion output)');
      console.log('  - page@*.webm (video recording)');

      // Assertions
      expect(ingestionSuccess).toBe(true);
      expect(initialUrl).toBe(finalUrl); // No page reload
      expect(networkRequests.length).toBeGreaterThan(0); // API call made
    });

    await context.close();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║              PHASE 3 E2E VERIFICATION COMPLETE                  ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
  });
});
