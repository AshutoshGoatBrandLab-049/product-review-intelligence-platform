import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';

// NOTE: page.waitForTimeout() was removed in Puppeteer v22, so every call here
// threw and took the surrounding assertions down with it. Replaced with a plain
// timer. `headless` was also the STRING 'false' (truthy — it ran headless
// regardless) and is now a real boolean.

describe('Pagination - Real Browser Automation Test', () => {
  // This file launches a REAL Chrome and drives it against the running dev
  // server, while vitest runs the other files in parallel. Under that contention
  // short waits time out intermittently (observed 335/336 on alternate runs), so
  // every wait here is sized for a loaded machine rather than an idle one.
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    // Set viewport to simulate desktop
    await page.setViewport({ width: 1920, height: 1080 });
  });

  afterEach(async () => {
    await page.close();
  });

  it('should navigate to pagination page and verify initial load', async () => {
    console.log('\n=== TEST 1: Initial Page Load ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=1', {
      waitUntil: 'networkidle2',
    });

    // Wait for table to appear
    await page.waitForSelector('table tbody', { timeout: 45000 });

    // Check if products are loaded
    const productRows = await page.$$('table tbody tr');
    console.log(`✅ Loaded ${productRows.length} products`);
    expect(productRows.length).toBeGreaterThan(0);

    // Get first product rank
    const firstRank = await page.$eval('table tbody tr:first-child td:first-child', (el) => el.textContent);
    console.log(`✅ First product rank: ${firstRank}`);
  }, 120000);

  it('should click Previous button and verify smooth transition', async () => {
    console.log('\n=== TEST 2: Click Previous Button ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=2', {
      waitUntil: 'networkidle2',
    });

    // Wait for REAL data, not the skeleton.
    //
    // The loading skeleton also renders <table><tbody>, so waiting on that alone
    // returned while the page was still loading and the pagination controls had
    // not rendered yet — which is why the Previous button was never found.
    await page.waitForSelector('table tbody tr:not(.animate-pulse)', { timeout: 45000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('Previous')),
      { timeout: 45000 },
    );

    // Get products on page 2
    const page2Products = await page.$$eval('table tbody tr', (rows) =>
      rows.map((row) => row.textContent).slice(0, 3)
    );
    console.log(`📍 Page 2 products: ${page2Products[0]?.substring(0, 30)}`);

    // Start performance measurement
    const startTime = Date.now();

    // Click Previous button
    const buttons = await page.$$('button');
    let clicked = false;
    for (const btn of buttons) {
      const text = await page.evaluate((el) => el.textContent, btn);
      if (text?.includes('Previous')) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);

    // Wait for navigation and skeleton to appear
    await page.evaluate(() => new Promise(r => setTimeout(r, 100)));

    // Check if skeleton is visible
    const skeletonVisible = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return rows.length > 0 && rows[0].classList.contains('animate-pulse');
    });
    console.log(`${skeletonVisible ? '✅' : '❌'} Skeleton visible: ${skeletonVisible}`);

    // Wait for the transition to actually COMPLETE.
    //
    // "not a skeleton row" is not enough: between the click and the refetch
    // landing, the table still holds the PREVIOUS page's real rows, so the test
    // read stale content and the "products changed" assertion compared a row
    // against itself. Waiting for the page indicator to move is the signal that
    // the new data is rendered.
    await page.waitForFunction(
      (expected) => {
        const rows = document.querySelectorAll('table tbody tr');
        const settled = rows.length > 0 && !rows[0].classList.contains('animate-pulse');
        const label = document.querySelector('.text-gray-300')?.textContent ?? '';
        return settled && label.includes(`Page ${expected}`);
      },
      { timeout: 45000 },
      2,
    );

    const loadTime = Date.now() - startTime;
    console.log(`⏱️  Total transition time: ${loadTime}ms`);

    // Get products on page 1 (after Previous)
    const page1Products = await page.$$eval('table tbody tr', (rows) =>
      rows.map((row) => row.textContent).slice(0, 3)
    );
    console.log(`📍 Page 1 products: ${page1Products[0]?.substring(0, 30)}`);

    // Verify products changed
    expect(page1Products[0]).not.toEqual(page2Products[0]);
    console.log('✅ Products changed correctly');

    // Check page indicator.
    //
    // `?page=N` is ZERO-BASED throughout the app (handleProductClick navigates
    // with page=${currentPage}, which is 0-based) while the indicator displays
    // N+1. So ?page=2 shows "Page 3 of 4", and Previous lands on "Page 2 of 4".
    // Asserting a literal "Page 1" encoded a 1-based URL convention the app has
    // never used. Assert the actual invariant instead: Previous decrements.
    const pageText = await page.$eval('.text-gray-300', (el) => el.textContent);
    console.log(`📄 Page indicator: ${pageText}`);

    const shown = Number(pageText?.match(/Page (\d+)/)?.[1]);
    expect(shown, `unexpected page indicator: ${pageText}`).toBe(2);
  }, 120000);

  it('should click Next button multiple times and verify performance', async () => {
    console.log('\n=== TEST 3: Multiple Next Clicks ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=0', {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('table tbody', { timeout: 45000 });

    const results = [];

    // Click Next 3 times and measure each
    for (let i = 0; i < 3; i++) {
      const startTime = Date.now();

      // Find and click Next button
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const nextBtn = buttons.find((btn) => btn.textContent?.includes('Next'));
        if (nextBtn) (nextBtn as HTMLButtonElement).click();
      });

      // Wait for transition
      await new Promise((r) => setTimeout(r, 100));

      // Wait for skeleton to disappear
      await page.waitForFunction(
        () => {
          const rows = document.querySelectorAll('table tbody tr');
          return rows.length > 0 && !rows[0].classList.contains('animate-pulse');
        },
        { timeout: 45000 }
      );

      const loadTime = Date.now() - startTime;
      results.push(loadTime);

      // Get current page
      const pageText = await page.$eval('.text-gray-300', (el) => el.textContent);
      console.log(`Click ${i + 1}: ${loadTime}ms - ${pageText}`);
    }

    const avgTime = results.reduce((a, b) => a + b, 0) / results.length;
    console.log(`📊 Average time per click: ${avgTime.toFixed(0)}ms`);
    console.log('✅ Multiple clicks successful');
  }, 45000);

  it('should measure scroll performance and jank', async () => {
    console.log('\n=== TEST 4: Scroll Performance ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=0', {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('table tbody', { timeout: 45000 });

    // Measure scroll to top speed
    const startScroll = Date.now();

    // Trigger scroll via click
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((btn) => btn.textContent?.includes('Next'));
      if (nextBtn) (nextBtn as HTMLButtonElement).click();
    });

    // Check if scroll happens
    await new Promise((r) => setTimeout(r, 50));
    const scrollY = await page.evaluate(() => window.scrollY);
    const scrollTime = Date.now() - startScroll;

    console.log(`⏱️  Scroll time: ${scrollTime}ms`);
    console.log(`📍 Scroll position: ${scrollY}px`);
    console.log(`${scrollY < 100 ? '✅' : '❌'} Scroll to top instant: ${scrollY < 100}`);
  }, 120000);

  it('should verify skeleton shows on page transition', async () => {
    console.log('\n=== TEST 5: Skeleton Visibility ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=0', {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('table tbody', { timeout: 45000 });

    // Click Next
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((btn) => btn.textContent?.includes('Next'));
      if (nextBtn) (nextBtn as HTMLButtonElement).click();
    });

    // Check skeleton visibility timeline
    const skeletonTimeline = [];

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));

      const isSkeletonVisible = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        if (rows.length === 0) return null;
        return rows[0].classList.contains('animate-pulse');
      });

      skeletonTimeline.push(isSkeletonVisible);

      if (isSkeletonVisible === false) break;
    }

    console.log(`📊 Skeleton visibility timeline (every 100ms): ${skeletonTimeline}`);
    console.log(`${skeletonTimeline[0] ? '✅' : '❌'} Skeleton appears immediately: ${skeletonTimeline[0]}`);
  }, 120000);
});
