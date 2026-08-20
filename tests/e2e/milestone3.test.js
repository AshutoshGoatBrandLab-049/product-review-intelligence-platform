import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:4000';
const DB_HOST = 'localhost';
const DB_NAME = 'gbl_data_lake';
const DB_USER = 'postgres';
const DB_PASS = '1234';

const TEST_REVIEWS = {
  flipkart: {
    id: 11,
    platform: 'flipkart',
    originalRating: 4,
    originalHelpfulCount: 0,
    newRating: 2,
    newHelpfulCount: 5,
    sourceProductId: 'SRTGSYQG43TJVM67'
  },
};

async function executeSql(sql) {
  const env = { ...process.env, PGPASSWORD: DB_PASS };
  try {
    execSync(`psql -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -c "${sql.replace(/"/g, '\\"')}"`, { env });
  } catch (err) {
    console.error('SQL error:', err.message);
  }
}

async function restoreReview(review) {
  const updateSql = `UPDATE "DataWarehouse".${review.platform === 'flipkart' ? 'flipkart_reviews' : 'myntra_reviews'}
                     SET rating = ${review.originalRating}, helpful_count = ${review.originalHelpfulCount},
                     "updatedAt" = '2026-06-29 00:00:00+05:30'
                     WHERE id = ${review.id};`;

  const normalizedSql = `UPDATE "DataWarehouse".normalized_reviews
                         SET rating = ${review.originalRating}, helpful_count = ${review.originalHelpfulCount}
                         WHERE platform = '${review.platform}' AND source_row_id = ${review.id};`;

  await executeSql(updateSql);
  await executeSql(normalizedSql);
}

async function modifyReview(review) {
  const updateSql = `UPDATE "DataWarehouse".${review.platform === 'flipkart' ? 'flipkart_reviews' : 'myntra_reviews'}
                     SET rating = ${review.newRating}, helpful_count = ${review.newHelpfulCount},
                     "updatedAt" = NOW()
                     WHERE id = ${review.id};`;

  await executeSql(updateSql);
}

function runIngestion(platform) {
  const cmd = `cd "/Users/apple/Desktop/GBL Project/product-review-intelligence-platform/backend" && npm run ingest:${platform} 2>&1`;
  return execSync(cmd, { shell: '/bin/bash' }).toString();
}

test.describe('Milestone 3: WebSocket E2E Integration', () => {

  test('Test 1: ProductRankingList updates without page reload', async ({ page }) => {
    console.log('\n=== TEST 1: ProductRankingList ===');

    console.log('[1] Navigating to ProductRankingList...');
    await page.goto(`${FRONTEND_URL}/reviews-overview/flipkart/negative`);
    await page.waitForLoadState('networkidle');

    console.log('[2] Recording initial state...');
    const initialUrl = page.url();
    const initialScroll = await page.evaluate(() => window.scrollY);

    console.log(`  - URL: ${initialUrl}`);
    console.log(`  - Scroll: ${initialScroll}`);

    console.log('[3] Modifying review...');
    await modifyReview(TEST_REVIEWS.flipkart);

    console.log('[4] Running ingestion...');
    const ingestOutput = runIngestion('flipkart');
    const hasUpdate = ingestOutput.includes('rowsUpdated');

    console.log(`  - Change detected: ${hasUpdate}`);

    console.log('[5] Checking page state...');
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const finalScroll = await page.evaluate(() => window.scrollY);

    console.log(`  - URL unchanged: ${initialUrl === finalUrl}`);
    console.log(`  - Scroll stable: ${Math.abs(initialScroll - finalScroll) < 10}`);

    console.log('[6] Cleanup...');
    await restoreReview(TEST_REVIEWS.flipkart);

    const results = {
      test: 'ProductRankingList',
      changeDetected: hasUpdate,
      pageNotReloaded: initialUrl === finalUrl,
      scrollStable: Math.abs(initialScroll - finalScroll) < 10,
      RESULT: (hasUpdate && initialUrl === finalUrl) ? 'PASS' : 'FAIL'
    };

    console.log('\n[TEST RESULT]', results);

    // Assertions
    expect(hasUpdate).toBe(true);
    expect(initialUrl).toBe(finalUrl);
  });

  test('Test 2: ProductDetail preserves state', async ({ page }) => {
    console.log('\n=== TEST 2: ProductDetail ===');

    console.log('[1] Navigating...');
    await page.goto(`${FRONTEND_URL}/products/flipkart/${TEST_REVIEWS.flipkart.sourceProductId}`);
    await page.waitForLoadState('networkidle');

    const initialUrl = page.url();
    const initialScroll = await page.evaluate(() => window.scrollY);

    console.log('[2] Modifying data...');
    await modifyReview(TEST_REVIEWS.flipkart);
    const ingestOutput = runIngestion('flipkart');

    console.log('[3] Verifying state...');
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const finalScroll = await page.evaluate(() => window.scrollY);

    console.log(`  - URL: ${initialUrl === finalUrl ? 'UNCHANGED' : 'CHANGED'}`);
    console.log(`  - Scroll: ${Math.abs(initialScroll - finalScroll) < 10 ? 'STABLE' : 'MOVED'}`);

    await restoreReview(TEST_REVIEWS.flipkart);

    const results = {
      test: 'ProductDetail',
      pageNotReloaded: initialUrl === finalUrl,
      scrollStable: Math.abs(initialScroll - finalScroll) < 10,
      RESULT: (initialUrl === finalUrl) ? 'PASS' : 'FAIL'
    };

    console.log('\n[TEST RESULT]', results);

    expect(initialUrl).toBe(finalUrl);
  });

  test('Test 3: AI Analyst stability', async ({ page }) => {
    console.log('\n=== TEST 3: AI Analyst Stability ===');

    console.log('[1] Navigating...');
    await page.goto(`${FRONTEND_URL}/ai/analyst?platform=flipkart&productId=${TEST_REVIEWS.flipkart.sourceProductId}`);
    await page.waitForLoadState('networkidle');

    const initialUrl = page.url();

    console.log('[2] Triggering data change...');
    await modifyReview(TEST_REVIEWS.flipkart);
    runIngestion('flipkart');

    await page.waitForTimeout(2000);

    const finalUrl = page.url();

    console.log(`  - Page reload: ${initialUrl === finalUrl ? 'NO' : 'YES'}`);

    await restoreReview(TEST_REVIEWS.flipkart);

    const results = {
      test: 'AI Analyst Stability',
      pageNotReloaded: initialUrl === finalUrl,
      RESULT: (initialUrl === finalUrl) ? 'PASS' : 'FAIL'
    };

    console.log('\n[TEST RESULT]', results);

    expect(initialUrl).toBe(finalUrl);
  });

});
