import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';

describe('Pagination - Full Monitoring Test with Visual Feedback', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: false, // ✅ SHOW ACTUAL BROWSER WINDOW
      args: ['--no-sandbox', '--disable-gpu'],
      defaultViewport: { width: 1920, height: 1080 },
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
  });

  afterEach(async () => {
    await page.close();
  });

  it('should monitor pagination with full performance metrics', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 FULL PAGINATION TEST - MONITORING EVERYTHING');
    console.log('='.repeat(80));

    // Navigate to page
    console.log('\n📍 Step 1: Navigating to page 1...');
    await page.goto('http://localhost:5173/reviews-overview/flipkart/positive?page=0', {
      waitUntil: 'networkidle2',
    });

    // Wait for table to load
    await page.waitForSelector('table tbody', { timeout: 5000 });
    console.log('✅ Page 1 loaded successfully');

    // Get initial products
    const page1Products = await page.$$eval('table tbody tr td:first-child', (cells) =>
      cells.slice(0, 3).map((c) => c.textContent)
    );
    console.log(`📊 Page 1 products (first 3): ${page1Products.join(', ')}`);

    // Take screenshot of page 1
    await page.screenshot({
      path: '/tmp/pagination-page1.png',
      fullPage: false,
    });
    console.log('📸 Screenshot saved: pagination-page1.png');

    // ============================================
    // TEST: Click Next Button
    // ============================================
    console.log('\n' + '-'.repeat(80));
    console.log('📌 Step 2: CLICKING NEXT BUTTON & MONITORING...');
    console.log('-'.repeat(80));

    const metrics = await page.evaluate(() => {
      return new Promise<{
        scrollStart: number;
        paintStart: number;
        frameTimings: number[];
        renderComplete: number;
      }>((resolve) => {
        const scrollStart = performance.now();
        let paintStart = 0;
        const frameTimings: number[] = [];
        let frameCount = 0;

        // Monitor frames using requestAnimationFrame
        const monitorFrames = () => {
          frameTimings.push(performance.now());
          frameCount++;

          // Monitor for 2 seconds
          if (frameTimings[frameTimings.length - 1] - scrollStart < 2000) {
            requestAnimationFrame(monitorFrames);
          } else {
            resolve({
              scrollStart,
              paintStart,
              frameTimings,
              renderComplete: performance.now(),
            });
          }
        };

        // Start monitoring
        requestAnimationFrame(monitorFrames);

        // Detect first paint
        if ('PerformanceObserver' in window) {
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (paintStart === 0) paintStart = entry.startTime;
              }
            }).observe({ entryTypes: ['paint'] });
          } catch (e) {
            // Paint observer not supported
          }
        }
      });
    });

    // Click Next button
    console.log('🖱️  Clicking Next button...');
    const clickTime = Date.now();
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find((btn) => btn.textContent?.includes('Next'));
      if (nextBtn) (nextBtn as HTMLButtonElement).click();
    });

    // Monitor skeleton visibility
    console.log('👁️  Monitoring skeleton visibility...');
    let skeletonAppeared = false;
    let skeletonAppearTime = 0;
    let skeletonDisappearTime = 0;

    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

      const isSkeleton = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return rows.length > 0 && rows[0].classList.contains('animate-pulse');
      });

      if (isSkeleton && !skeletonAppeared) {
        skeletonAppeared = true;
        skeletonAppearTime = Date.now() - clickTime;
        console.log(`  ⚡ Skeleton appeared after ${skeletonAppearTime}ms`);
      }

      if (!isSkeleton && skeletonAppeared && skeletonDisappearTime === 0) {
        skeletonDisappearTime = Date.now() - clickTime;
        console.log(`  ⚡ Skeleton disappeared after ${skeletonDisappearTime}ms`);
        break;
      }
    }

    // Get new products
    console.log('\n📦 Checking if products changed...');
    const page2Products = await page.$$eval('table tbody tr td:first-child', (cells) =>
      cells.slice(0, 3).map((c) => c.textContent)
    );
    console.log(`📊 Page 2 products (first 3): ${page2Products.join(', ')}`);

    const productsChanged = page1Products[0] !== page2Products[0];
    console.log(`${productsChanged ? '✅' : '❌'} Products changed: ${productsChanged}`);

    // Get page indicator
    const pageIndicator = await page.$eval('.text-gray-300', (el) => el.textContent || '');
    console.log(`📄 Page indicator: ${pageIndicator}`);

    // Take screenshot of page 2
    await page.screenshot({
      path: '/tmp/pagination-page2.png',
      fullPage: false,
    });
    console.log('📸 Screenshot saved: pagination-page2.png');

    // ============================================
    // JANK DETECTION
    // ============================================
    console.log('\n' + '-'.repeat(80));
    console.log('📊 JANK & PERFORMANCE ANALYSIS');
    console.log('-'.repeat(80));

    const totalTime = skeletonDisappearTime || 2000;
    console.log(`⏱️  Total transition time: ${totalTime}ms`);
    console.log(`⏱️  Skeleton appear time: ${skeletonAppearTime}ms`);
    console.log(`⏱️  Skeleton display time: ${skeletonDisappearTime - skeletonAppearTime}ms`);

    // Analyze jank
    if (skeletonAppearTime > 200) {
      console.log('⚠️  WARNING: Skeleton appeared slow (>200ms)');
    } else {
      console.log('✅ Skeleton appeared fast (<200ms)');
    }

    if (skeletonDisappearTime > 2500) {
      console.log('⚠️  WARNING: Total transition slow (>2.5s)');
    } else if (skeletonDisappearTime < 1500) {
      console.log('✅ Total transition FAST (<1.5s)');
    } else {
      console.log('⚠️  Total transition MODERATE (1.5-2.5s)');
    }

    // ============================================
    // SCROLL MONITORING
    // ============================================
    console.log('\n' + '-'.repeat(80));
    console.log('🔄 SCROLL BEHAVIOR');
    console.log('-'.repeat(80));

    const scrollY = await page.evaluate(() => window.scrollY);
    console.log(`📍 Scroll position: ${scrollY}px (should be 0)`);
    console.log(`${scrollY < 50 ? '✅' : '❌'} Scroll to top: ${scrollY < 50 ? 'INSTANT' : 'DELAYED'}`);

    // ============================================
    // TEST: Click Previous
    // ============================================
    console.log('\n' + '-'.repeat(80));
    console.log('📌 Step 3: CLICKING PREVIOUS BUTTON & MONITORING...');
    console.log('-'.repeat(80));

    const previousClickTime = Date.now();
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const prevBtn = buttons.find((btn) => btn.textContent?.includes('Previous'));
      if (prevBtn) (prevBtn as HTMLButtonElement).click();
    });

    console.log('🖱️  Clicked Previous button');

    // Monitor skeleton for Previous click
    let prevSkeletonTime = 0;
    for (let i = 0; i < 50; i++) {
      await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

      const isSkeleton = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        return rows.length > 0 && rows[0].classList.contains('animate-pulse');
      });

      if (!isSkeleton && prevSkeletonTime === 0) {
        prevSkeletonTime = Date.now() - previousClickTime;
        console.log(`⚡ Previous click transition: ${prevSkeletonTime}ms`);
        break;
      }
    }

    const prevProducts = await page.$$eval('table tbody tr td:first-child', (cells) =>
      cells.slice(0, 3).map((c) => c.textContent)
    );
    console.log(`📊 Back to Page 1: ${prevProducts.join(', ')}`);
    console.log(`${prevProducts[0] === page1Products[0] ? '✅' : '❌'} Correct products on Previous`);

    await page.screenshot({
      path: '/tmp/pagination-previous.png',
      fullPage: false,
    });
    console.log('📸 Screenshot saved: pagination-previous.png');

    // ============================================
    // FINAL VERDICT
    // ============================================
    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL VERDICT');
    console.log('='.repeat(80));

    const isSmooth = skeletonAppearTime < 200 && skeletonDisappearTime < 2500;
    const hasJank = skeletonAppearTime > 200 || skeletonDisappearTime > 2500;

    console.log(`\n${isSmooth ? '✅ SMOOTH & FAST' : '⚠️  NEEDS IMPROVEMENT'}`);
    console.log(`\nMetrics:`);
    console.log(`  • Skeleton appear: ${skeletonAppearTime}ms ${skeletonAppearTime < 200 ? '✅' : '⚠️'}`);
    console.log(`  • Total transition: ${skeletonDisappearTime}ms ${skeletonDisappearTime < 2500 ? '✅' : '⚠️'}`);
    console.log(`  • Previous click: ${prevSkeletonTime}ms ${prevSkeletonTime < 2500 ? '✅' : '⚠️'}`);
    console.log(`  • Products change: ${productsChanged ? '✅' : '❌'}`);
    console.log(`  • Scroll instant: ${scrollY < 50 ? '✅' : '❌'}`);

    console.log(`\n${hasJank ? '❌ JANK DETECTED - See metrics above' : '✅ NO JANK DETECTED'}`);
    console.log('='.repeat(80) + '\n');

    // Assertions
    expect(skeletonAppeared).toBe(true);
    expect(productsChanged).toBe(true);
    expect(scrollY).toBeLessThan(50);
  }, 60000);
});
