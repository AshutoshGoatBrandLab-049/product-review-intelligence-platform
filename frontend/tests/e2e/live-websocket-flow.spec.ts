/**
 * FULL PRODUCTION FLOW — end-to-end, in a real browser, against live data.
 *
 *   source table change
 *     → in-process ingestion trigger (Track A / Track B)
 *     → canonical synchronized
 *     → transaction COMMIT
 *     → PRODUCT_DATA_UPDATED
 *     → WebSocket
 *     → browser
 *     → invalidate ONLY the affected platform's cache
 *     → fresh API request
 *     → ProductRankingList updates
 *     → NO page reload
 *
 * Ingestion is triggered through POST /internal/ingestion/trigger rather than a
 * CLI script on purpose: the event has to be emitted by the SAME process that
 * owns the WebSocket server, otherwise it is broadcast to an emitter no browser
 * is attached to and never arrives.
 *
 * Live-data safety: rows added here use a dedicated product id and an
 * E2EWS- review_id prefix. The test removes them and re-runs ingestion in
 * afterAll, so the database ends where it started.
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = "http://localhost:5173";
const API = "http://localhost:4000";
const SCHEMA = "DataWarehouse";
const TEST_PRODUCT = "999900001";       // does not collide with real myntra product ids
const TAG = "E2EWS";
const NEW_ROWS = 12;

/** `pg` is a backend dependency, so talk to Postgres through psql instead. */
const PGPASSWORD = (() => {
  const env = readFileSync(join(process.cwd(), "..", "backend", ".env"), "utf8");
  return env.match(/^DB_PASSWORD=(.*)$/m)?.[1] ?? "";
})();

function sql(query: string): string {
  return execFileSync(
    "psql",
    ["-h", "localhost", "-U", "postgres", "-d", "gbl_data_lake", "-At", "-c", query],
    { env: { ...process.env, PGPASSWORD }, encoding: "utf8" },
  ).trim();
}

async function counts() {
  const out = sql(
    `SELECT (SELECT COUNT(*) FROM "${SCHEMA}".myntra_reviews)
         ||','|| (SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE platform='myntra')
         ||','|| (SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE platform='flipkart')`,
  );
  const [src, canon, fk] = out.split(",").map(Number);
  return { src, canon, fk };
}


/** Admin token — /internal/ingestion/trigger is admin-only. */
function adminToken(): string {
  return execFileSync("npx", ["tsx", "scripts/issueDevToken.ts", "admin", "e2e-admin"], {
    cwd: join(process.cwd(), "..", "backend"),
    encoding: "utf8",
  }).trim().split("\n").pop()!.trim();
}

async function triggerIngestion() {
  const res = await fetch(`${API}/internal/ingestion/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ platform: "myntra" }),
  });
  return { status: res.status, body: await res.text() };
}

/** Row count currently rendered in the ranking table. */
async function rowCount(page: Page) {
  return page.locator("table tbody tr").count();
}

test.describe("full production flow (live data)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    // Clean any residue from a previous interrupted run.
    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-%'`);
  });

  test.afterAll(async () => {
    // Remove the temporary rows and let ingestion restore canonical exactly.
    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-%'`);
    const r = await triggerIngestion();
    console.log(`[CLEANUP] ingestion after removal: HTTP ${r.status}`);
    const c = await counts();
    console.log(`[CLEANUP] final: source=${c.src} canonical=${c.canon} flipkart=${c.fk}`);
  });

  test("source change propagates to ProductRankingList with NO page reload", async ({ page }) => {
    // ── capture browser-side evidence ────────────────────────────────────────
    const wsEvents: string[] = [];
    const apiCalls: string[] = [];
    let reloadCount = 0;

    page.on("websocket", (ws) => {
      console.log(`[WS] opened ${ws.url()}`);
      ws.on("framereceived", (f) => {
        const payload = typeof f.payload === "string" ? f.payload : "";
        if (payload.includes("PRODUCT_DATA_UPDATED")) wsEvents.push(payload.slice(0, 160));
      });
    });
    page.on("request", (r) => {
      if (r.url().includes("/v1/reviews/overview")) apiCalls.push(r.url());
    });
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) reloadCount++;
    });

    // ── 1. load the list and let it settle ───────────────────────────────────
    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(1500); // allow the websocket to connect

    const before = await counts();
    const rowsBefore = await rowCount(page);
    const navBefore = reloadCount;
    const apiBefore = apiCalls.length;
    console.log(`[BEFORE] db source=${before.src} canonical=${before.canon} | UI rows=${rowsBefore}`);
    expect(rowsBefore).toBeGreaterThan(0);

    // ── 2. change the SOURCE table (the only thing that starts the chain) ────
    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews
         (product_id, brand_name, review_id, rating, title, body, review_date, reviewed_at, author_name)
       SELECT ${TEST_PRODUCT}::int, 'E2E-LiveCheck', '${TAG}-' || g, 5, 'e2e', 'e2e body',
              CURRENT_DATE, now(), 'e2e'
       FROM generate_series(1, ${NEW_ROWS}) g`,
    );
    const afterInsert = await counts();
    console.log(`[SOURCE CHANGED] +${NEW_ROWS} rows → source=${afterInsert.src}`);
    expect(afterInsert.src).toBe(before.src + NEW_ROWS);

    // ── 3. trigger ingestion IN the API process ──────────────────────────────
    const trig = await triggerIngestion();
    console.log(`[INGEST] HTTP ${trig.status}`);
    expect(trig.status).toBe(200);

    const afterIngest = await counts();
    console.log(`[COMMIT] canonical=${afterIngest.canon} (was ${before.canon})`);
    expect(afterIngest.canon, "canonical must absorb the new source rows").toBe(before.canon + NEW_ROWS);
    expect(afterIngest.fk, "FLIPKART MUST BE UNTOUCHED").toBe(before.fk);

    // ── 4. the browser must update ON ITS OWN ────────────────────────────────
    await expect
      .poll(async () => wsEvents.length, {
        message: "browser never received PRODUCT_DATA_UPDATED over the websocket",
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    console.log(`[WS] PRODUCT_DATA_UPDATED frames received: ${wsEvents.length}`);
    console.log(`[WS] sample: ${wsEvents[0]}`);

    await expect
      .poll(async () => apiCalls.length, {
        message: "no fresh API request was issued after the websocket event",
        timeout: 30_000,
      })
      .toBeGreaterThan(apiBefore);
    console.log(`[API] refetches after event: ${apiCalls.length - apiBefore}`);
    console.log(`[API] last: ${apiCalls[apiCalls.length - 1]}`);

    await expect
      .poll(async () => rowCount(page), { message: "UI row count never changed", timeout: 30_000 })
      .toBe(rowsBefore + 1); // one brand-new product joins the list
    const rowsAfter = await rowCount(page);
    console.log(`[UI] rows ${rowsBefore} → ${rowsAfter} (no reload)`);

    // ── 5. the new product must actually be on screen ────────────────────────
    await expect(page.locator(`table tbody tr:has-text("${TEST_PRODUCT}")`)).toHaveCount(1);
    const newRow = await page
      .locator(`table tbody tr:has-text("${TEST_PRODUCT}")`)
      .first()
      .locator("td")
      .allInnerTexts();
    console.log(`[UI] new row: ${newRow.slice(0, 6).join(" | ")}`);
    expect(newRow.join(" ")).toContain("E2E-LiveCheck");

    // ── 6. NO page reload happened ───────────────────────────────────────────
    expect(reloadCount, "the page must NOT have reloaded").toBe(navBefore);
    console.log(`[UI] main-frame navigations during update: ${reloadCount - navBefore} ✅`);

    await page.screenshot({ path: "test-results/live-ws-flow-updated.png", fullPage: true });
  });

  test("cache invalidation is scoped to the affected platform only", async ({ page }) => {
    // Populate the flipkart cache, then confirm a myntra event leaves it alone.
    await page.goto(`${UI}/reviews-overview/flipkart/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });

    const keysBefore = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("ranking-")),
    );
    console.log(`[CACHE] before: ${JSON.stringify(keysBefore)}`);
    expect(keysBefore.some((k) => k.startsWith("ranking-flipkart-"))).toBe(true);

    // Fire a myntra event by changing myntra source and ingesting.
    sql(
      `UPDATE "${SCHEMA}".myntra_reviews SET rating = 4, "updatedAt" = now()
        WHERE review_id LIKE '${TAG}-%'`,
    );
    await triggerIngestion();
    await page.waitForTimeout(4000);

    const keysAfter = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("ranking-")),
    );
    console.log(`[CACHE] after myntra event: ${JSON.stringify(keysAfter)}`);

    expect(
      keysAfter.some((k) => k.startsWith("ranking-flipkart-")),
      "a myntra event must NOT clear the flipkart cache",
    ).toBe(true);
  });
});
