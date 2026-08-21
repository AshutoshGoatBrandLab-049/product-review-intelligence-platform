/**
 * Test 14 — WebSocket disconnect / reconnect.
 *
 * While the browser's socket is down the database must keep converging, and once
 * the socket comes back the tab must end up showing current data WITHOUT a reload.
 *
 * This is the case the old client could not survive: it gave up permanently after
 * 10 reconnect attempts, so a backend restart lasting longer than ~30s left the tab
 * silently disconnected for good.
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = "http://localhost:5173";
const SCHEMA = "DataWarehouse";
const TAG = "E2EWSR";
const PROD = "999900013";
const BACKEND = join(process.cwd(), "..", "backend");

const PGPASSWORD = (() => {
  const env = readFileSync(join(BACKEND, ".env"), "utf8");
  return env.match(/^DB_PASSWORD=(.*)$/m)?.[1] ?? "";
})();

function sql(q: string): string {
  return execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", "gbl_data_lake", "-At", "-c", q], {
    env: { ...process.env, PGPASSWORD },
    encoding: "utf8",
  }).trim();
}

const canon = () =>
  Number(sql(`SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE source_review_id LIKE '${TAG}-%'`));
const uiRows = (p: Page) => p.locator("table tbody tr").count();
const stamp = () => new Date().toISOString();

function killBackend() {
  // -sTCP:LISTEN matters. Plain `lsof -ti:4000` matches every process holding a
  // connection on that port, CLIENTS included — which took down the Vite dev
  // server's socket too, and Vite's HMR client calls location.reload() when it
  // reconnects. That reload was a artifact of this helper, not app behaviour.
  try {
    execFileSync("bash", [
      "-c",
      "lsof -tiTCP:4000 -sTCP:LISTEN | xargs -r kill -9 2>/dev/null; " +
        "lsof -tiTCP:8080 -sTCP:LISTEN | xargs -r kill -9 2>/dev/null; true",
    ]);
  } catch {
    /* nothing listening */
  }
}

function startBackend() {
  const child = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: BACKEND,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
}

test.describe("Test 14 — WebSocket disconnect / reconnect", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(({}, testInfo) => testInfo.setTimeout(240_000));

  test.afterAll(async () => {
    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-%'`);
    if (!process.env.KEEP_BACKEND_DOWN) startBackend();
    await new Promise((r) => setTimeout(r, 25_000));
    console.log(`[CLEANUP] canonical for tag = ${canon()}`);
  });

  test("DB keeps converging while the socket is down, and the UI catches up after reconnect", async ({ page }) => {
    let navigations = 0;
    const navLog: string[] = [];
    const wsEvents: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) {
        navigations++;
        navLog.push(`${stamp()} -> ${f.url()}`);
      }
    });
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("[vite]") || t.includes("WebSocket")) console.log(`[browser] ${stamp()} ${t.slice(0, 90)}`);
    });
    page.on("websocket", (ws) =>
      ws.on("framereceived", (f) => {
        const s = typeof f.payload === "string" ? f.payload : "";
        if (s.includes("PRODUCT_DATA_UPDATED")) wsEvents.push(stamp());
      }),
    );

    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(2000);

    const rowsBefore = await uiRows(page);
    const navAfterLoad = navigations;
    console.log(`[T14] ${stamp()}  UI loaded: ${rowsBefore} rows`);

    // ── socket goes away ─────────────────────────────────────────────────────
    killBackend();
    console.log(`[T14] ${stamp()}  backend + websocket KILLED`);
    await page.waitForTimeout(6000);

    // ── source changes while the browser is disconnected ─────────────────────
    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews (product_id,brand_name,review_id,rating,title,body,review_date,reviewed_at,author_name)
       SELECT ${PROD},'E2E-WSR','${TAG}-'||g,5,'t','b',CURRENT_DATE,now(),'a' FROM generate_series(1,9) g`,
    );
    console.log(`[T14] ${stamp()}  inserted 9 rows while disconnected — canonical=${canon()}`);
    expect(canon(), "nothing can ingest while the backend is down").toBe(0);

    // Stay down long enough that the OLD client (10 attempts, ~30s) would have
    // given up permanently. This is the regression this test exists for.
    await page.waitForTimeout(45_000);
    console.log(`[T14] ${stamp()}  ~50s downtime elapsed`);

    // ── backend returns ──────────────────────────────────────────────────────
    startBackend();
    console.log(`[T14] ${stamp()}  backend RESTARTED`);

    // The detector's boot tick must converge the database on its own.
    await expect
      .poll(() => canon(), { timeout: 120_000, message: "detector never recovered the offline changes" })
      .toBe(9);
    console.log(`[T14] ${stamp()}  DB converged: canonical=9`);

    // ── the tab must end up correct, without a reload ────────────────────────
    await expect
      .poll(() => uiRows(page), {
        timeout: 120_000,
        message: "UI never caught up after websocket reconnect",
      })
      .toBe(rowsBefore + 1);

    console.log(`[T14] ${stamp()}  UI caught up: ${rowsBefore} → ${await uiRows(page)}`);
    console.log(`[T14] websocket events received after reconnect: ${wsEvents.length}`);

    await expect(page.locator(`table tbody tr:has-text("${PROD}")`)).toHaveCount(1);
    console.log(`[T14] navigations:\n${navLog.join("\n")}`);
    expect(navigations, "the page must NOT have reloaded").toBe(navAfterLoad);
    console.log(`[T14] reloads: ${navigations - navAfterLoad} ✅`);
  });
});
