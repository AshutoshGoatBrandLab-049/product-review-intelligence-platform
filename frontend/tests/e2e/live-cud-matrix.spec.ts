/**
 * "If I add / update / delete data in the source tables, does the UI update?"
 *
 * Answers it by DOING each operation against the live database and observing the
 * real browser — no assumptions. Covers, for both marketplaces:
 *
 *   1. change with NO ingestion trigger        → does the UI move on its own?
 *   2. INSERT + ingestion                      → new product appears
 *   3. UPDATE (recent review) + ingestion      → rating changes, product reclassifies
 *   4. UPDATE (review older than Track B's window) + ingestion → is it seen at all?
 *   5. DELETE + ingestion                      → product disappears
 *
 * All rows use a dedicated product id and an E2ECUD- prefix, and are removed in
 * afterAll, so the live database ends exactly where it started.
 */

import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = "http://localhost:5173";
const API = "http://localhost:4000";
const SCHEMA = "DataWarehouse";
const TAG = "E2ECUD";
const PROD_MY = "999900002";
const PROD_FK = "PID-E2ECUD-1";

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


/** Admin token — /internal/ingestion/trigger is admin-only. */
function adminToken(): string {
  return execFileSync("npx", ["tsx", "scripts/issueDevToken.ts", "admin", "e2e-admin"], {
    cwd: join(process.cwd(), "..", "backend"),
    encoding: "utf8",
  }).trim().split("\n").pop()!.trim();
}

async function ingest(platform: string) {
  const res = await fetch(`${API}/internal/ingestion/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ platform }),
  });
  return res.status;
}

function canonCount(platform: string, like: string) {
  return Number(
    sql(
      `SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews
        WHERE platform='${platform}' AND source_review_id LIKE '${like}'`,
    ),
  );
}

/** Average rating the API reports for a product, or null if absent. */
async function apiAvg(platform: string, type: string, productId: string): Promise<number | null> {
  const token = execFileSync(
    "npx",
    ["tsx", "scripts/issueDevToken.ts", "viewer", "dev-viewer"],
    { cwd: join(process.cwd(), "..", "backend"), encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .pop()!
    .trim();
  const res = await fetch(
    `${API}/v1/reviews/overview?platform=${platform}&type=${type}&page=0&reviewWindow=latest10`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = (await res.json()) as any;
  const hit = json.products?.find((p: any) => p.sourceProductId === productId);
  return hit ? Number(hit.averageRating) : null;
}

async function uiRows(page: Page) {
  return page.locator("table tbody tr").count();
}

function cleanupAll() {
  sql(`DELETE FROM "${SCHEMA}".myntra_reviews   WHERE review_id LIKE '${TAG}-%'`);
  sql(`DELETE FROM "${SCHEMA}".flipkart_reviews WHERE review_id LIKE '${TAG}-%'`);
}

test.describe("live CUD → UI matrix", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => cleanupAll());

  test.afterAll(async () => {
    cleanupAll();
    await ingest("myntra");
    await ingest("flipkart");
    const my = sql(
      `SELECT (SELECT COUNT(*) FROM "${SCHEMA}".myntra_reviews)||'/'||(SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE platform='myntra')`,
    );
    const fk = sql(
      `SELECT (SELECT COUNT(*) FROM "${SCHEMA}".flipkart_reviews)||'/'||(SELECT COUNT(*) FROM "${SCHEMA}".normalized_reviews WHERE platform='flipkart')`,
    );
    console.log(`[RESTORED] myntra src/canon=${my}   flipkart src/canon=${fk}`);
  });

  test("1. a source change WITHOUT an ingestion trigger does NOT reach the UI", async ({ page }) => {
    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const before = await uiRows(page);

    // Insert directly into the SOURCE table. Nothing else.
    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews
         (product_id, brand_name, review_id, rating, title, body, review_date, reviewed_at, author_name)
       SELECT ${PROD_MY}, 'E2E-NoTrigger', '${TAG}-nt-' || g, 5, 't', 'b', CURRENT_DATE, now(), 'a'
       FROM generate_series(1,10) g`,
    );
    console.log(`[NO-TRIGGER] inserted 10 source rows; watching UI for 15s…`);

    await page.waitForTimeout(15_000);

    const after = await uiRows(page);
    const canon = canonCount("myntra", `${TAG}-nt-%`);
    console.log(`[NO-TRIGGER] UI rows ${before} → ${after} | canonical rows for new data: ${canon}`);

    expect(canon, "nothing ingests the change on its own").toBe(0);
    expect(after, "UI cannot show what was never ingested").toBe(before);

    // Clean up this step's rows before the next test.
    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-nt-%'`);
  });

  test("2. ADD → ingest → product appears in the UI", async ({ page }) => {
    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const before = await uiRows(page);

    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews
         (product_id, brand_name, review_id, rating, title, body, review_date, reviewed_at, author_name)
       SELECT ${PROD_MY}, 'E2E-CUD', '${TAG}-a-' || g, 5, 't', 'b', CURRENT_DATE, now(), 'a'
       FROM generate_series(1,10) g`,
    );
    expect(await ingest("myntra")).toBe(200);

    await expect.poll(() => uiRows(page), { timeout: 30_000 }).toBe(before + 1);
    const avg = await apiAvg("myntra", "positive", PROD_MY);
    console.log(`[ADD] UI rows ${before} → ${await uiRows(page)} | API avg = ${avg}`);
    expect(avg).toBe(5);
    await expect(page.locator(`table tbody tr:has-text("${PROD_MY}")`)).toHaveCount(1);
  });

  test("3. UPDATE a recent review → ingest → rating changes and product RECLASSIFIES", async ({ page }) => {
    // Currently avg 5.0 → sits in GOOD. Drop every rating to 1 → must move to BAD.
    await page.goto(`${UI}/reviews-overview/myntra/positive`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const goodBefore = await uiRows(page);

    sql(
      `UPDATE "${SCHEMA}".myntra_reviews SET rating = 1, "updatedAt" = now()
        WHERE review_id LIKE '${TAG}-a-%'`,
    );
    expect(await ingest("myntra")).toBe(200);

    const avgGood = await apiAvg("myntra", "positive", PROD_MY);
    const avgBad = await apiAvg("myntra", "negative", PROD_MY);
    console.log(`[UPDATE recent] API good-avg=${avgGood}  bad-avg=${avgBad}`);

    expect(avgGood, "must no longer be in GOOD").toBeNull();
    expect(avgBad, "must now be in BAD with avg 1.0").toBe(1);

    // The GOOD list the browser is showing must drop it, with no reload.
    await expect.poll(() => uiRows(page), { timeout: 30_000 }).toBe(goodBefore - 1);
    await expect(page.locator(`table tbody tr:has-text("${PROD_MY}")`)).toHaveCount(0);
    console.log(`[UPDATE recent] GOOD list ${goodBefore} → ${await uiRows(page)} ✅ reclassified`);
  });

  test("4. UPDATE a review OLDER than Track B's window", async () => {
    // Seed one review dated well outside the 70-day reconciliation window.
    sql(
      `INSERT INTO "${SCHEMA}".myntra_reviews
         (product_id, brand_name, review_id, rating, title, body, review_date, reviewed_at, author_name)
       VALUES (${PROD_MY}, 'E2E-CUD', '${TAG}-old-1', 5, 't', 'b',
               CURRENT_DATE - 200, now() - interval '200 days', 'a')`,
    );
    expect(await ingest("myntra")).toBe(200);
    const ratingAfterInsert = sql(
      `SELECT rating FROM "${SCHEMA}".normalized_reviews
        WHERE platform='myntra' AND source_review_id='${TAG}-old-1'`,
    );
    console.log(`[UPDATE old] ingested with rating=${ratingAfterInsert}`);
    expect(ratingAfterInsert).toBe("5");

    // Now EDIT it. Track A won't revisit it (id <= watermark); Track B's window
    // starts 70 days ago, so a 200-day-old review is outside its scan.
    sql(
      `UPDATE "${SCHEMA}".myntra_reviews SET rating = 1, "updatedAt" = now()
        WHERE review_id = '${TAG}-old-1'`,
    );
    expect(await ingest("myntra")).toBe(200);

    const canonRating = sql(
      `SELECT rating FROM "${SCHEMA}".normalized_reviews
        WHERE platform='myntra' AND source_review_id='${TAG}-old-1'`,
    );
    const srcRating = sql(
      `SELECT rating FROM "${SCHEMA}".myntra_reviews WHERE review_id='${TAG}-old-1'`,
    );
    console.log(`[UPDATE old] source rating=${srcRating}  canonical rating=${canonRating}`);
    console.log(
      canonRating === srcRating
        ? "[UPDATE old] ✅ propagated"
        : "[UPDATE old] ❌ NOT propagated — canonical is stale",
    );

    // Recorded as an observation, not asserted, so the result is reported either way.
    expect(["1", "5"]).toContain(canonRating);
  });

  test("5. DELETE → ingest → product disappears from the UI", async ({ page }) => {
    const wsEvents: string[] = [];
    const apiCalls: string[] = [];
    const sockets: string[] = [];
    page.on("websocket", (ws) => {
      sockets.push(ws.url());
      ws.on("framereceived", (f) => {
        const p = typeof f.payload === "string" ? f.payload : "";
        if (p.includes("PRODUCT_DATA_UPDATED")) wsEvents.push(p.slice(0, 120));
      });
    });
    page.on("request", (r) => {
      if (r.url().includes("/v1/reviews/overview")) apiCalls.push(r.url());
    });

    await page.goto(`${UI}/reviews-overview/myntra/negative`, { waitUntil: "networkidle" });
    await page.waitForSelector("table tbody tr", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const badBefore = await uiRows(page);
    const apiAtLoad = apiCalls.length;
    const wsAtLoad = wsEvents.length;
    console.log(`[DELETE] after page load: sockets=${sockets.length} wsFrames=${wsAtLoad} apiCalls=${apiAtLoad}`);
    expect(await apiAvg("myntra", "negative", PROD_MY)).not.toBeNull();

    sql(`DELETE FROM "${SCHEMA}".myntra_reviews WHERE review_id LIKE '${TAG}-%'`);
    expect(await ingest("myntra")).toBe(200);

    expect(canonCount("myntra", `${TAG}-%`), "canonical must shed the deleted rows").toBe(0);
    expect(await apiAvg("myntra", "negative", PROD_MY), "gone from the API").toBeNull();
    expect(
      Number(sql(`SELECT COUNT(*) FROM "${SCHEMA}".product_dimension WHERE source_product_id='${PROD_MY}'`)),
      "gone from product_dimension",
    ).toBe(0);

    await page.waitForTimeout(3000);
    console.log(`[DELETE] sockets opened: ${sockets.length}`);
    console.log(`[DELETE] ws frames  at-load=${wsAtLoad}  total=${wsEvents.length}  delta=${wsEvents.length - wsAtLoad}`);
    console.log(`[DELETE] api calls  at-load=${apiAtLoad}  total=${apiCalls.length}  delta=${apiCalls.length - apiAtLoad}`);
    if (wsEvents[0]) console.log(`[DELETE] ws sample: ${wsEvents[0]}`);
    console.log(`[DELETE] api refetches: ${apiCalls.length} | last: ${apiCalls[apiCalls.length - 1] ?? "none"}`);

    await expect.poll(() => uiRows(page), { timeout: 30_000 }).toBe(badBefore - 1);
    console.log(`[DELETE] BAD list ${badBefore} → ${await uiRows(page)} ✅ removed`);
  });

  test("6. FLIPKART: add → update → delete behaves identically", async () => {
    sql(
      `INSERT INTO "${SCHEMA}".flipkart_reviews
         (pid, brand_name, review_id, rating, title, comment, review_date, author_name)
       SELECT '${PROD_FK}', 'E2E-CUD', '${TAG}-f-' || g, 5, 't', 'c', CURRENT_DATE, 'a'
       FROM generate_series(1,10) g`,
    );
    expect(await ingest("flipkart")).toBe(200);
    expect(canonCount("flipkart", `${TAG}-f-%`)).toBe(10);
    expect(await apiAvg("flipkart", "positive", PROD_FK)).toBe(5);
    console.log(`[FK ADD] ✅ 10 rows, avg 5.0 in GOOD`);

    sql(
      `UPDATE "${SCHEMA}".flipkart_reviews SET rating = 1, "updatedAt" = now()
        WHERE review_id LIKE '${TAG}-f-%'`,
    );
    expect(await ingest("flipkart")).toBe(200);
    expect(await apiAvg("flipkart", "positive", PROD_FK)).toBeNull();
    expect(await apiAvg("flipkart", "negative", PROD_FK)).toBe(1);
    console.log(`[FK UPDATE] ✅ reclassified GOOD → BAD`);

    sql(`DELETE FROM "${SCHEMA}".flipkart_reviews WHERE review_id LIKE '${TAG}-f-%'`);
    expect(await ingest("flipkart")).toBe(200);
    expect(canonCount("flipkart", `${TAG}-f-%`)).toBe(0);
    expect(await apiAvg("flipkart", "negative", PROD_FK)).toBeNull();
    console.log(`[FK DELETE] ✅ removed`);
  });
});
