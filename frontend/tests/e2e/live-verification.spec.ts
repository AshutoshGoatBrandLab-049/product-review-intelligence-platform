/**
 * Live end-to-end verification against the REPAIRED gbl_data_lake data.
 *
 * Proves the full production path renders in a real browser:
 *   source → TrackA → commit → API → ProductRankingList
 * and that the WebSocket channel the refresh depends on is actually connected.
 *
 * Captures screenshots as evidence rather than asserting only on counts.
 */

import { test, expect } from "@playwright/test";

const UI = "http://localhost:5174";

test.describe("live data verification", () => {
  test("Myntra ranking list renders repaired data with real brands", async ({ page }) => {
    const wsUrls: string[] = [];
    page.on("websocket", (ws) => wsUrls.push(ws.url()));

    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });

    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    console.log(`[UI] Myntra positive rows rendered: ${count}`);

    // Header must include the Brand column.
    const headers = await page.locator("table thead th").allInnerTexts();
    console.log(`[UI] columns: ${headers.join(" | ")}`);
    expect(headers.join(" ")).toContain("Brand");

    // First row should carry REAL data, not placeholders.
    const first = await rows.first().locator("td").allInnerTexts();
    console.log(`[UI] first row: ${first.join(" | ")}`);
    expect(first.join(" ")).not.toContain("Unknown Brand");

    // Every visible average must satisfy the GOOD classification (>= 3.0).
    const avgCells = await rows.locator("td:nth-child(5)").allInnerTexts();
    const avgs = avgCells.map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n));
    console.log(`[UI] averages sample: ${avgs.slice(0, 8).join(", ")}`);
    for (const a of avgs) expect(a).toBeGreaterThanOrEqual(3.0);

    await page.screenshot({ path: "test-results/live-myntra-good.png", fullPage: true });

    console.log(`[WS] websocket connections opened: ${JSON.stringify(wsUrls)}`);
    expect(wsUrls.some((u) => u.includes("8080"))).toBe(true);
  });

  test("Flipkart BAD reviews render and every average is < 3.0", async ({ page }) => {
    await page.goto(`${UI}/reviews-overview/flipkart/negative`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });

    const rows = page.locator("table tbody tr");
    console.log(`[UI] Flipkart negative rows rendered: ${await rows.count()}`);

    const avgCells = await rows.locator("td:nth-child(5)").allInnerTexts();
    const avgs = avgCells.map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n));
    console.log(`[UI] averages sample: ${avgs.slice(0, 8).join(", ")}`);
    expect(avgs.length).toBeGreaterThan(0);
    for (const a of avgs) expect(a).toBeLessThan(3.0);

    await page.screenshot({ path: "test-results/live-flipkart-bad.png", fullPage: true });
  });

  test("Flipkart GOOD reviews render and every average is >= 3.0", async ({ page }) => {
    await page.goto(`${UI}/reviews-overview/flipkart/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });

    const rows = page.locator("table tbody tr");
    console.log(`[UI] Flipkart positive rows rendered: ${await rows.count()}`);

    const avgCells = await rows.locator("td:nth-child(5)").allInnerTexts();
    const avgs = avgCells.map((t) => parseFloat(t)).filter((n) => !Number.isNaN(n));
    console.log(`[UI] averages sample: ${avgs.slice(0, 8).join(", ")}`);
    expect(avgs.length).toBeGreaterThan(0);
    for (const a of avgs) expect(a).toBeGreaterThanOrEqual(3.0);

    await page.screenshot({ path: "test-results/live-flipkart-good.png", fullPage: true });
  });
});
