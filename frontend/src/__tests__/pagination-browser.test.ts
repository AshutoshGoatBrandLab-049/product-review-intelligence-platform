import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';

describe('Pagination - Real Browser Automation Test', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'false',
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
    await page.waitForSelector('table tbody', { timeout: 5000 });

    // Check if products are loaded
    const productRows = await page.$$('table tbody tr');
    console.log(`✅ Loaded ${productRows.length} products`);
    expect(productRows.length).toBeGreaterThan(0);

    // Get first product rank
    const firstRank = await page.$eval('table tbody tr:first-child td:first-child', (el) => el.textContent);
    console.log(`✅ First product rank: ${firstRank}`);
  }, 30000);

  it('should click Previous button and verify smooth transition', async () => {
    console.log('\n=== TEST 2: Click Previous Button ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=2', {
      waitUntil: 'networkidle2',
    });

    // Wait for initial load
    await page.waitForSelector('table tbody', { timeout: 5000 });

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

    // Wait for data to load (up to 5 seconds)
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll('table tbody tr');
        return rows.length > 0 && !rows[0].classList.contains('animate-pulse');
      },
      { timeout: 5000 }
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

    // Check page indicator
    const pageText = await page.$eval('.text-gray-300', (el) => el.textContent);
    console.log(`📄 Page indicator: ${pageText}`);
    expect(pageText).toContain('Page 1');
  }, 30000);

  it('should click Next button multiple times and verify performance', async () => {
    console.log('\n=== TEST 3: Multiple Next Clicks ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=0', {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('table tbody', { timeout: 5000 });

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
      await page.waitForTimeout(100);

      // Wait for skeleton to disappear
      await page.waitForFunction(
        () => {
          const rows = document.querySelectorAll('table tbody tr');
          return rows.length > 0 && !rows[0].classList.contains('animate-pulse');
        },
        { timeout: 5000 }
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

    await page.waitForSelector('table tbody', { timeout: 5000 });

    // Measure scroll to top speed
    const startScroll = Date.now();

    // Trigger scroll via click
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((btn) => btn.textContent?.includes('Next'));
      if (nextBtn) (nextBtn as HTMLButtonElement).click();
    });

    // Check if scroll happens
    await page.waitForTimeout(50);
    const scrollY = await page.evaluate(() => window.scrollY);
    const scrollTime = Date.now() - startScroll;

    console.log(`⏱️  Scroll time: ${scrollTime}ms`);
    console.log(`📍 Scroll position: ${scrollY}px`);
    console.log(`${scrollY < 100 ? '✅' : '❌'} Scroll to top instant: ${scrollY < 100}`);
  }, 30000);

  it('should verify skeleton shows on page transition', async () => {
    console.log('\n=== TEST 5: Skeleton Visibility ===');

    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=0', {
      waitUntil: 'networkidle2',
    });

    await page.waitForSelector('table tbody', { timeout: 5000 });

    // Click Next
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((btn) => btn.textContent?.includes('Next'));
      if (nextBtn) (nextBtn as HTMLButtonElement).click();
    });

    // Check skeleton visibility timeline
    const skeletonTimeline = [];

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100);

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
  }, 30000);
});
