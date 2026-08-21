/**
 * AUTOMATIC SOURCE-TABLE SYNC — Tests 1-15.
 *
 * The defining constraint: these tests NEVER call an ingestion endpoint or CLI.
 * The only thing they do is run raw SQL against the marketplace source tables and
 * then watch a real browser. Anything that happens in between must have been
 * started by the detector on its own.
 *
 *   direct SQL → detection → ingestion → COMMIT → WebSocket → browser → API → UI
 *
 * Every row is tagged E2EAUTO- and removed in afterAll.
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const UI = "http://localhost:5173";
const API = "http://localhost:4000";
const SCHEMA = "DataWarehouse";
const TAG = "E2EAUTO";
const PROD_MY = "999900010";
const PROD_FK = "PID-E2EAUTO-1";

/** Detector polls every 5s; allow generous headroom for ingestion itself. */
const AUTO = 90_000;

const PGPASSWORD = (() => {
  const env = readFileSync(join(process.cwd(), "..", "backend", ".env"), "utf8");
  return env.match(/^DB_PASSWORD=(.*)$/m)?.[1] ?? "";
})();

function sql(q: string): string {
  return execFileSync(
    "psql",
    ["-h", "localhost", "-U", "postgres", "-d", "gbl_data_lake", "-At", "-c", q],
    { env: { ...process.env, PGPASSWORD }, encoding: "utf8" },
  ).trim();
}

const now = () => new Date().toISOString();
const canon = (platform: string, like: string) =>
  Number(
    sql(
      `SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews
        WHERE platform='${platform}' AND source_review_id LIKE '${like}'`,
    ),
  );
const uiRows = (page: Page) => page.locator("table tbody tr").count();

/** Timestamped evidence, written to disk so the ordering can be audited. */
const evidence: string[] = [];
function record(label: string, detail = "") {
  const line = `${now()}  ${label.padEnd(34)} ${detail}`;
  evidence.push(line);
  console.log(`  [E] ${line}`);
}

interface Probe {
  wsEvents: { at: string; payload: string }[];
  apiCalls: { at: string; url: string }[];
  navigations: number;
}

function instrument(page: Page): Probe {
  const p: Probe = { wsEvents: [], apiCalls: [], navigations: 0 };
  page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      const s = typeof f.payload === "string" ? f.payload : "";
      if (s.includes("PRODUCT_DATA_UPDATED")) p.wsEvents.push({ at: now(), payload: s.slice(0, 110) });
    }),
  );
  page.on("request", (r) => {
    if (r.url().includes("/v1/reviews/overview") || r.url().includes("/v1/products/"))
      p.apiCalls.push({ at: now(), url: r.url() });
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) p.navigations++;
  });
  return p;
}

function cleanup() {
  sql(`DELETE FROM "${SCHEMA}".myntra_reviews   WHERE review_id LIKE '${TAG}-%'`);
  sql(`DELETE FROM "${SCHEMA}".flipkart_reviews WHERE review_id LIKE '${TAG}-%'`);
}

/** Wait until the detector has converged canonical for a tagged set. */
async function waitForCanonical(platform: string, like: string, expected: number) {
  await expect
    .poll(() => canon(platform, like), {
      timeout: AUTO,
      message: `canonical never reached ${expected} for ${like} — detector did not fire`,
    })
    .toBe(expected);
}

test.describe("AUTOMATIC source sync (no manual ingestion anywhere)", () => {
  test.describe.configure({ mode: "serial" });

  // No playwright.config.ts exists, so the default per-test timeout is 30s. These
  // tests wait on a 5s detector poll plus real ingestion, so they need their own.
  // NOTE: a trailing numeric argument to test() is Vitest syntax — Playwright
  // silently ignores it, which is what capped T15 at 30s and made a successful
  // cleanup look like a detector failure.
  test.beforeEach(({}, testInfo) => testInfo.setTimeout(AUTO * 3));

  test.beforeAll(() => cleanup());

  test.afterAll(async () => {
    cleanup();
    // Let the detector clean up after itself — deliberately NOT triggering ingestion.
    await new Promise((r) => setTimeout(r, 20_000));
    console.log(
      `[RESTORED] myntra=${sql(`SELECT (SELECT COUNT(*) FROM "${SCHEMA}".myntra_reviews)||'/'||(SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE platform='myntra')`)}` +
        `  flipkart=${sql(`SELECT (SELECT COUNT(*) FROM "${SCHEMA}".flipkart_reviews)||'/'||(SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE platform='flipkart')`)}`,
    );
    try {
      mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
      writeFileSync(join(process.cwd(), "test-results", "auto-sync-evidence.txt"), evidence.join("\n"));
    } catch {
      /* evidence is also in stdout */
    }
  });

  // ── Test 1 — Myntra INSERT, full timestamped chain ───────────────────────────
  test("T1. Myntra INSERT → detection → ingest → commit → WS → browser → API → UI", async ({ page }) => {
    const probe = instrument(page);

    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(2000);

    const uiBefore = await uiRows(page);
    const srcBefore = Number(sql(`SELECT COUNT(*) FROM "${SCHEMA}".myntra_reviews`));
    const wsBefore = probe.wsEvents.length;
    const apiBefore = probe.apiCalls.length;
    const navBefore = probe.navigations;
    record("1. SOURCE DB BEFORE", `source=${srcBefore} uiRows=${uiBefore}`);

    const sqlStmt = `INSERT INTO "${SCHEMA}".myntra_reviews (product_id,brand_name,review_id,rating,title,body,review_date,reviewed_at,author_name) SELECT ${PROD_MY},'E2E-Auto','${TAG}-m-'||g,5,'t','b',CURRENT_DATE,now(),'a' FROM generate_series(1,10) g`;
    record("2. SQL EXECUTED", "INSERT 10 rows into myntra_reviews (NO ingestion call)");
    sql(sqlStmt);

    // 3-5: detection + ingestion + commit are observable as canonical converging.
    await waitForCanonical("myntra", `${TAG}-m-%`, 10);
    record("3-5. DETECTED+INGESTED+COMMIT", `canonical=${canon("myntra", `${TAG}-m-%`)}`);

    await expect.poll(() => probe.wsEvents.length, { timeout: AUTO }).toBeGreaterThan(wsBefore);
    record("6-7. WEBSOCKET EMITTED+RECEIVED", probe.wsEvents[probe.wsEvents.length - 1].payload);

    await expect.poll(() => probe.apiCalls.length, { timeout: AUTO }).toBeGreaterThan(apiBefore);
    record("8. API REFRESH", probe.apiCalls[probe.apiCalls.length - 1].url.slice(0, 90));

    await expect.poll(() => uiRows(page), { timeout: AUTO }).toBe(uiBefore + 1);
    record("9-10. UI BEFORE→AFTER", `${uiBefore} → ${await uiRows(page)}`);

    await expect(page.locator(`table tbody tr:has-text("${PROD_MY}")`)).toHaveCount(1);
    expect(probe.navigations, "NO page reload").toBe(navBefore);
    record("RELOAD COUNT", `${probe.navigations - navBefore} ✅`);
  });

  // ── Test 2 — Flipkart INSERT ─────────────────────────────────────────────────
  test("T2. Flipkart INSERT reaches the UI automatically", async ({ page }) => {
    const probe = instrument(page);
    await page.goto(`${UI}/reviews-overview/flipkart/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    const wsBefore = probe.wsEvents.length;

    sql(
      `INSERT INTO "${SCHEMA}".flipkart_reviews (pid,brand_name,review_id,rating,title,comment,review_date,author_name)
       SELECT '${PROD_FK}','E2E-Auto','${TAG}-f-'||g,5,'t','c',CURRENT_DATE,'a' FROM generate_series(1,10) g`,
    );
    record("T2 SQL", "INSERT 10 rows into flipkart_reviews");

    await waitForCanonical("flipkart", `${TAG}-f-%`, 10);
    await expect.poll(() => probe.wsEvents.length, { timeout: AUTO }).toBeGreaterThan(wsBefore);
    await expect(page.locator(`table tbody tr:has-text("${PROD_FK}")`)).toHaveCount(1, { timeout: AUTO });
    record("T2 RESULT", "flipkart product visible in UI ✅");
  });

  // ── Tests 3/4 — UPDATE + reclassification ────────────────────────────────────
  test("T3. Myntra UPDATE reclassifies GOOD → BAD automatically", async ({ page }) => {
    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    const goodBefore = await uiRows(page);

    // Bare UPDATE — does NOT touch updatedAt, so only pg_stat counters can see it.
    sql(`UPDATE "${SCHEMA}".myntra_reviews SET rating = 1 WHERE review_id LIKE '${TAG}-m-%'`);
    record("T3 SQL", "UPDATE rating=1 (updatedAt untouched)");

    await expect
      .poll(
        () =>
          Number(
            sql(
              `SELECT COALESCE(MIN(rating),-1) FROM "${SCHEMA}".normalized_reviews WHERE platform='myntra' AND source_review_id LIKE '${TAG}-m-%'`,
            ),
          ),
        { timeout: AUTO, message: "canonical rating never updated" },
      )
      .toBe(1);
    record("T3 CANONICAL", "rating propagated to 1 ✅");

    await expect.poll(() => uiRows(page), { timeout: AUTO }).toBe(goodBefore - 1);
    await expect(page.locator(`table tbody tr:has-text("${PROD_MY}")`)).toHaveCount(0);
    record("T3 RESULT", `GOOD list ${goodBefore} → ${await uiRows(page)} (reclassified) ✅`);
  });

  test("T4. Flipkart UPDATE reclassifies automatically", async () => {
    sql(`UPDATE "${SCHEMA}".flipkart_reviews SET rating = 1 WHERE review_id LIKE '${TAG}-f-%'`);
    record("T4 SQL", "UPDATE flipkart rating=1");
    await expect
      .poll(
        () =>
          Number(
            sql(
              `SELECT COALESCE(MIN(rating),-1) FROM "${SCHEMA}".normalized_reviews WHERE platform='flipkart' AND source_review_id LIKE '${TAG}-f-%'`,
            ),
          ),
        { timeout: AUTO },
      )
      .toBe(1);
    record("T4 RESULT", "flipkart canonical rating=1 ✅");
  });

  // ── Tests 5/6 — DELETE, including the last-review case ───────────────────────
  test("T5+T6. Myntra DELETE of the LAST review removes the product from the UI", async ({ page }) => {
    const probe = instrument(page);
    await page.goto(`${UI}/reviews-overview/myntra/negative`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const badBefore = await uiRows(page);
    const wsBefore = probe.wsEvents.length;

    // Deletes EVERY review for this product — the regression case where the
    // product vanishes from product_dimension and used to emit no event at all.
    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-m-%'`);
    record("T5/T6 SQL", "DELETE all reviews for the product");

    await waitForCanonical("myntra", `${TAG}-m-%`, 0);
    await expect
      .poll(
        () =>
          Number(
            sql(`SELECT COUNT(*) FROM "${SCHEMA}".product_dimension WHERE source_product_id='${PROD_MY}'`),
          ),
        { timeout: AUTO },
      )
      .toBe(0);
    record("T5/T6 CANONICAL", "reviews + product_dimension removed ✅");

    await expect.poll(() => probe.wsEvents.length, { timeout: AUTO }).toBeGreaterThan(wsBefore);
    record("T5/T6 WEBSOCKET", "removal event received ✅");

    await expect.poll(() => uiRows(page), { timeout: AUTO }).toBe(badBefore - 1);
    await expect(page.locator(`table tbody tr:has-text("${PROD_MY}")`)).toHaveCount(0);
    record("T5/T6 UI", `BAD list ${badBefore} → ${await uiRows(page)} ✅`);
  });

  test("T7. Flipkart DELETE removes the product automatically", async () => {
    sql(`DELETE FROM "${SCHEMA}".flipkart_reviews WHERE review_id LIKE '${TAG}-f-%'`);
    record("T7 SQL", "DELETE all flipkart test reviews");
    await waitForCanonical("flipkart", `${TAG}-f-%`, 0);
    await expect
      .poll(
        () => Number(sql(`SELECT COUNT(*) FROM "${SCHEMA}".product_dimension WHERE source_product_id='${PROD_FK}'`)),
        { timeout: AUTO },
      )
      .toBe(0);
    record("T7 RESULT", "flipkart product removed ✅");
  });

  // ── Test 10 — historical UPDATE (older than the old 70-day window) ───────────
  test("T10. UPDATE of a review dated 1 year ago is detected automatically", async () => {
    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews (product_id,brand_name,review_id,rating,title,body,review_date,reviewed_at,author_name)
       VALUES (${PROD_MY},'E2E-Auto','${TAG}-old-1',5,'t','b',CURRENT_DATE-365,now()-interval '365 days','a')`,
    );
    await waitForCanonical("myntra", `${TAG}-old-1`, 1);
    record("T10 SETUP", "1-year-old review ingested automatically ✅");

    sql(`UPDATE "${SCHEMA}".myntra_reviews SET rating = 1 WHERE review_id = '${TAG}-old-1'`);
    record("T10 SQL", "UPDATE the 1-year-old review");

    await expect
      .poll(
        () =>
          sql(
            `SELECT rating FROM "${SCHEMA}".normalized_reviews WHERE platform='myntra' AND source_review_id='${TAG}-old-1'`,
          ),
        { timeout: AUTO, message: "historical update never propagated" },
      )
      .toBe("1");
    record("T10 RESULT", "historical edit propagated ✅");
  });

  // ── Test 11 — backfill BELOW the watermark ──────────────────────────────────
  test("T11. Backfill with ids BELOW the watermark is not silently lost", async () => {
    const wm = Number(
      sql(`SELECT last_seen_source_id FROM "${SCHEMA}".ingestion_watermarks WHERE platform='myntra'`),
    );
    const lowId = Number(
      sql(
        `SELECT MIN(g) FROM generate_series(1, ${wm} - 1) g
          WHERE NOT EXISTS (SELECT 1 FROM "${SCHEMA}".myntra_reviews m WHERE m.id = g)`,
      ),
    );
    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews (id,product_id,brand_name,review_id,rating,title,body,review_date,reviewed_at,author_name)
       VALUES (${lowId},${PROD_MY},'E2E-Auto','${TAG}-low-1',5,'t','b',CURRENT_DATE-200,now()-interval '200 days','a')`,
    );
    record("T11 SQL", `INSERT at id=${lowId} (watermark=${wm}) — below the cursor`);

    await waitForCanonical("myntra", `${TAG}-low-1`, 1);
    record("T11 RESULT", "below-watermark backfill ingested ✅");
  });

  // ── Test 15 — duplicate/runaway protection ──────────────────────────────────
  test("T15. One logical change does not cause runaway processing or events", async ({ page }) => {
    const probe = instrument(page);
    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    const wsBefore = probe.wsEvents.length;
    const apiBefore = probe.apiCalls.length;

    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews (product_id,brand_name,review_id,rating,title,body,review_date,reviewed_at,author_name)
       SELECT ${PROD_MY},'E2E-Auto','${TAG}-dup-'||g,5,'t','b',CURRENT_DATE,now(),'a' FROM generate_series(1,5) g`,
    );
    await waitForCanonical("myntra", `${TAG}-dup-%`, 5);

    // Let several more detector cycles elapse — a quiet source must stay quiet.
    await page.waitForTimeout(20_000);

    const wsDelta = probe.wsEvents.length - wsBefore;
    const apiDelta = probe.apiCalls.length - apiBefore;
    record("T15 COUNTS", `wsEvents=${wsDelta} apiCalls=${apiDelta} for 5 rows / 1 product`);

    // 5 rows on ONE product must dedupe to a small number of events, and idle
    // cycles afterwards must add none.
    expect(wsDelta, "events must be deduped by platform+product, not per row").toBeLessThanOrEqual(4);
    expect(apiDelta, "refetches must not run away").toBeLessThanOrEqual(6);

    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-dup-%'`);
    await waitForCanonical("myntra", `${TAG}-dup-%`, 0);
  });
});
