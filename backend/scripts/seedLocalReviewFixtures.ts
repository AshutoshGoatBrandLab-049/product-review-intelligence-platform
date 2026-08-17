/**
 * Local, production-like development dataset for DataWarehouse.flipkart_reviews
 * and DataWarehouse.myntra_reviews.
 *
 * This is NOT the isolated vitest test database (pri_test_prodsource) — it
 * seeds the real local `gbl_data_lake` database this project's DB_HOST/DB_NAME
 * already point at, purely so we can develop and volume-test the ingestion
 * pipeline without production credentials. It connects using config.appStore
 * ONLY — never config.prodReadOnly — and never reads or requires DB_PROD_*.
 *
 * Table shape is the same VERIFIED schema used by the existing test fixtures
 * (src/database/fixtures/*.sql, sourced from the crawlers' own model files),
 * not invented here.
 *
 * Safety:
 *  - refuses to run against a non-local host (assertLocalMigrationTarget)
 *  - inspects before creating anything; refuses to touch either table if it
 *    already exists with data, and reports instead of guessing
 *  - contains no DROP / TRUNCATE / DELETE anywhere
 *  - deterministic (fixed PRNG seed) so the dataset is reproducible
 *  - standalone dev tool — not imported by the ingestion pipeline or tests
 */
import { Client } from "pg";
import { config } from "../src/config/index.js";
import { assertLocalMigrationTarget } from "../src/config/assertLocalMigrationTarget.js";
import { mapFlipkartReview } from "../src/modules/ingestion/flipkart/mapper.js";
import { mapMyntraReview } from "../src/modules/ingestion/myntra/mapper.js";
import { computeContentHash } from "../src/modules/ingestion/shared/contentHash.js";
import { computeCanonicalReviewId } from "../src/modules/ingestion/shared/canonicalId.js";
import type { RawFlipkartReview, RawMyntraReview } from "../src/types/unifiedReview.js";
import { isMainModule } from "../src/shared/isMainModule.js";

const ROWS_PER_PLATFORM = 50_000;
const FLIPKART_PRODUCT_COUNT = 500;
const MYNTRA_PRODUCT_COUNT = 500;
const BATCH_SIZE = 2000;
const SEED = 42;

// ── Deterministic PRNG (mulberry32) — fixed seed, reproducible dataset ──────
function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

function randomInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)] as T;
}
function pickWeighted<T>(pairs: ReadonlyArray<[T, number]>): T {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, weight] of pairs) {
    r -= weight;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1]![0];
}

// ── Reference pools (all clearly synthetic — no real brands, people, or URLs) ──
const BRANDS = [
  "Northline", "Verona Basics", "CraftWear", "Bluepeak", "Solstice Studio",
  "Meridian Co.", "Fieldstone", "Anchorpoint", "Willowmere", "Cardinal & Co.",
  "Driftwood", "Ledger Goods", "Palecove", "Hearthside", "Rivermark",
  "Amberlane", "Thistledown", "Grovewell", "Coppertide", "Nightingale Basics",
];
const FIRST_NAMES = [
  "Ravi", "Priya", "Amit", "Sneha", "Arjun", "Kavya", "Rohit", "Ananya",
  "Vikram", "Divya", "Karan", "Neha", "Sanjay", "Pooja", "Rahul", "Meera",
  "Suresh", "Anjali", "Manoj", "Ritu", "Deepak", "Shreya", "Vivek", "Nisha",
];
const LAST_NAMES = [
  "K", "Sharma", "Patel", "Singh", "Iyer", "Gupta", "Nair", "Reddy",
  "Mehta", "Rao", "Verma", "Joshi", "Malhotra", "Kapoor", "Chauhan", "Das",
];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const COLORS = [
  "Black", "White", "Blue", "Red", "Green", "Grey", "Navy", "Beige",
  "Maroon", "Pink", "Yellow", "Olive",
] as const;
const THEMES = [
  "quality", "size", "fit", "delivery", "packaging", "value", "comfort",
  "color", "durability",
] as const;
type Sentiment = "positive" | "neutral" | "negative";

const THEME_CLAUSES: Record<(typeof THEMES)[number], Record<Sentiment, string[]>> = {
  quality: {
    positive: ["the quality feels premium and well made", "build quality exceeded expectations"],
    neutral: ["quality is about what I expected for the price", "quality is okay, nothing special"],
    negative: ["quality feels cheap for the price", "quality was disappointing"],
  },
  size: {
    positive: ["sizing was spot on", "true to size, fit perfectly"],
    neutral: ["size runs slightly different than expected but wearable", "sizing is roughly accurate"],
    negative: ["sizing runs way off, had to return", "size chart is misleading"],
  },
  fit: {
    positive: ["the fit is really flattering", "fits great, very comfortable cut"],
    neutral: ["fit is decent, could be better in places", "fit is average"],
    negative: ["fit was awkward and boxy", "the fit just didn't work for me"],
  },
  delivery: {
    positive: ["delivery was fast, arrived earlier than expected", "quick delivery, no complaints"],
    neutral: ["delivery took the usual amount of time", "delivery was on schedule"],
    negative: ["delivery took way longer than promised", "delivery was delayed multiple times"],
  },
  packaging: {
    positive: ["packaging was neat and secure", "arrived in excellent packaging"],
    neutral: ["packaging was standard", "packaging was fine, nothing notable"],
    negative: ["packaging was damaged on arrival", "poor packaging, box was crushed"],
  },
  value: {
    positive: ["great value for the price", "worth every rupee"],
    neutral: ["reasonably priced for what you get", "fair value overall"],
    negative: ["overpriced for what you actually get", "not worth the money"],
  },
  comfort: {
    positive: ["extremely comfortable to wear all day", "super comfortable fabric"],
    neutral: ["comfort is acceptable", "comfortable enough for regular wear"],
    negative: ["not very comfortable after a few hours", "fabric felt scratchy and uncomfortable"],
  },
  color: {
    positive: ["color is exactly as shown in the pictures", "love the color, looks even better in person"],
    neutral: ["color is close to the pictures, slightly different in daylight", "color is acceptable"],
    negative: ["color looked completely different from the pictures", "color faded after the first wash"],
  },
  durability: {
    positive: ["holding up really well after weeks of use", "very durable, no wear so far"],
    neutral: ["durability seems average so far", "too early to tell on durability"],
    negative: ["started falling apart within days", "durability is a real concern"],
  },
};
const OPENERS: Record<Sentiment, string[]> = {
  positive: ["Really happy with this purchase.", "Pleasantly surprised overall.", "Would definitely buy again."],
  neutral: ["Mixed feelings about this one.", "An average purchase overall.", "It's okay, does the job."],
  negative: ["Pretty disappointed with this order.", "Not what I expected at all.", "Would not recommend."],
};
const TITLES: Record<Sentiment, string[]> = {
  positive: ["Great purchase!", "Highly recommend", "Very satisfied", "Loved it"],
  neutral: ["It's okay", "Average product", "Does the job", "Mixed experience"],
  negative: ["Disappointed", "Not as expected", "Would not buy again", "Poor experience"],
};

function sentimentForRating(rating: number): Sentiment {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

function generateReviewText(rating: number): { title: string; text: string } {
  const sentiment = sentimentForRating(rating);
  const themeCount = randomInt(1, 3);
  const shuffledThemes = [...THEMES].sort(() => rand() - 0.5).slice(0, themeCount);
  const clauses = shuffledThemes.map((theme) => pick(THEME_CLAUSES[theme][sentiment]));
  const text = [pick(OPENERS[sentiment]), ...clauses.map((c) => c[0]!.toUpperCase() + c.slice(1) + ".")].join(" ");
  return { title: pick(TITLES[sentiment]), text };
}

function authorName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

// review_date distribution across the last 12 months, per the requested buckets.
const DATE_BUCKETS: Array<[[number, number], number]> = [
  [[0, 30], 0.2],
  [[31, 60], 0.15],
  [[61, 90], 0.15],
  [[91, 180], 0.25],
  [[181, 365], 0.25],
];

function randomReviewDate(): { date: Date; daysAgo: number } {
  const [lo, hi] = pickWeighted(DATE_BUCKETS);
  const daysAgo = randomInt(lo, hi);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return { date, daysAgo };
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Realistic crawler timestamp behavior: createdAt is set once, at the review's
 * original crawl time (shortly after review_date). updatedAt starts the same,
 * but for reviews still inside the ~60-70 day rolling reconciliation window,
 * there's a good chance the crawler has re-upserted the row since — bumping
 * updatedAt to something recent while every content field stays exactly what
 * was originally captured. This is precisely the "updatedAt changes without
 * content changing" behavior the whole Track A/B design exists to handle.
 */
function timestampsFor(reviewDate: Date, daysAgo: number): { createdAt: Date; updatedAt: Date } {
  const createdAt = new Date(reviewDate);
  createdAt.setUTCDate(createdAt.getUTCDate() + randomInt(0, 3));
  createdAt.setUTCHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59));

  let updatedAt = new Date(createdAt);
  const withinReconciliationWindow = daysAgo <= 70;
  if (withinReconciliationWindow && rand() < 0.4) {
    const recentDaysAgo = randomInt(0, Math.min(14, daysAgo));
    updatedAt = new Date();
    updatedAt.setUTCDate(updatedAt.getUTCDate() - recentDaysAgo);
    updatedAt.setUTCHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59));
  }
  return { createdAt, updatedAt };
}

function fakeHash(input: string, length: number): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, "0").repeat(4);
  return hex.slice(0, length);
}

// ── Row builders ─────────────────────────────────────────────────────────────
interface FlipkartRow {
  brand_name: string;
  pid: string;
  review_id: string;
  rating: number;
  title: string;
  comment: string;
  review_date: string;
  product_url: string;
  author_name: string;
  verified_purchase: boolean;
  helpful_count: number;
  country: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MyntraRow {
  product_id: number;
  brand_name: string;
  review_id: string;
  rating: number;
  title: null;
  body: string;
  review_date: string;
  reviewed_at: Date;
  author_name: string;
  helpful_count: number;
  not_helpful_count: number;
  has_images: boolean;
  image_urls: string[] | null;
  size_purchased: string | null;
  color_purchased: string | null;
  product_url: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
}

function productWeights(count: number, total: number): number[] {
  const raw = Array.from({ length: count }, () => 0.1 + rand() * rand());
  const sum = raw.reduce((a, b) => a + b, 0);
  const counts = raw.map((w) => Math.floor((w / sum) * total));
  let remainder = total - counts.reduce((a, b) => a + b, 0);
  while (remainder > 0) {
    counts[randomInt(0, count - 1)]! += 1;
    remainder--;
  }
  return counts;
}

function buildFlipkartRows(): FlipkartRow[] {
  const rows: FlipkartRow[] = [];
  const counts = productWeights(FLIPKART_PRODUCT_COUNT, ROWS_PER_PLATFORM);
  for (let p = 0; p < FLIPKART_PRODUCT_COUNT; p++) {
    const pid = `FKPID${String(p + 1).padStart(6, "0")}`;
    const brand = pick(BRANDS);
    for (let r = 0; r < counts[p]!; r++) {
      const rating = pickWeighted<number>([[5, 0.38], [4, 0.27], [3, 0.14], [2, 0.09], [1, 0.12]]);
      const { title, text } = generateReviewText(rating);
      const { date, daysAgo } = randomReviewDate();
      const { createdAt, updatedAt } = timestampsFor(date, daysAgo);
      rows.push({
        brand_name: brand,
        pid,
        review_id: fakeHash(`fk-${p}-${r}-${SEED}`, 24),
        rating,
        title,
        comment: text,
        review_date: toDateOnly(date),
        product_url: `https://www.flipkart.local/p/${pid}`,
        author_name: authorName(),
        verified_purchase: rand() < 0.7,
        helpful_count: Math.floor(rand() * rand() * 60),
        country: rand() < 0.97 ? "India" : "",
        createdAt,
        updatedAt,
      });
    }
  }
  return rows;
}

function buildMyntraRows(): MyntraRow[] {
  const rows: MyntraRow[] = [];
  const counts = productWeights(MYNTRA_PRODUCT_COUNT, ROWS_PER_PLATFORM);
  for (let p = 0; p < MYNTRA_PRODUCT_COUNT; p++) {
    const productId = 100_001 + p;
    const brand = pick(BRANDS);
    for (let r = 0; r < counts[p]!; r++) {
      const rating = pickWeighted<number>([[5, 0.4], [4, 0.26], [3, 0.13], [2, 0.09], [1, 0.12]]);
      const { text } = generateReviewText(rating);
      const { date, daysAgo } = randomReviewDate();
      const { createdAt, updatedAt } = timestampsFor(date, daysAgo);
      const reviewedAt = new Date(date);
      reviewedAt.setUTCHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59));
      const hasImages = rand() < 0.2;
      const hasSizeColor = rand() < 0.6;
      rows.push({
        product_id: productId,
        brand_name: brand,
        review_id: String(1_000_000_000 + p * 1000 + r),
        rating,
        title: null, // always null upstream on Myntra — see mapper.ts
        body: text,
        review_date: toDateOnly(date),
        reviewed_at: reviewedAt,
        author_name: authorName(),
        helpful_count: Math.floor(rand() * rand() * 60),
        not_helpful_count: Math.floor(rand() * rand() * 20),
        has_images: hasImages,
        image_urls: hasImages
          ? Array.from({ length: randomInt(1, 4) }, (_, i) => `https://cdn.myntra.local/reviews/${productId}-${r}-${i}.jpg`)
          : null,
        size_purchased: hasSizeColor ? pick(SIZES) : null,
        color_purchased: hasSizeColor ? pick(COLORS) : null,
        product_url: `https://www.myntra.local/p/${productId}`,
        country: "India",
        createdAt,
        updatedAt,
      });
    }
  }
  return rows;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function batchInsert<T extends object>(
  client: Client,
  table: string,
  columns: string[],
  rows: T[],
  batchSize: number,
): Promise<void> {
  const quotedColumns = columns.map((c) => (c === c.toLowerCase() ? c : `"${c}"`));
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of batch) {
      const record = row as Record<string, unknown>;
      const placeholders = columns.map((col) => {
        values.push(record[col]);
        return `$${values.length}`;
      });
      tuples.push(`(${placeholders.join(",")})`);
    }
    await client.query(
      `INSERT INTO "DataWarehouse".${table} (${quotedColumns.join(",")}) VALUES ${tuples.join(",")}`,
      values,
    );
  }
}

interface TableInspection {
  exists: boolean;
  rowCount: number;
}

async function inspectTable(client: Client, table: string): Promise<TableInspection> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'DataWarehouse' AND table_name = $1
     ) AS exists`,
    [table],
  );
  const exists = rows[0]!.exists;
  if (!exists) return { exists: false, rowCount: 0 };

  const { rows: countRows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "DataWarehouse".${table}`,
  );
  return { exists: true, rowCount: Number(countRows[0]!.count) };
}

const FLIPKART_DDL = `
  CREATE TABLE "DataWarehouse".flipkart_reviews (
    id                  SERIAL PRIMARY KEY,
    brand_name          VARCHAR,
    pid                 VARCHAR NOT NULL,
    review_id           VARCHAR(30) NOT NULL,
    rating              INTEGER NOT NULL,
    title               VARCHAR,
    comment             TEXT,
    review_date         DATE NOT NULL,
    product_url         TEXT,
    author_name         VARCHAR,
    verified_purchase   BOOLEAN DEFAULT false,
    helpful_count       INTEGER DEFAULT 0,
    country             VARCHAR,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pid, review_id)
  );
  CREATE INDEX flipkart_reviews_pid ON "DataWarehouse".flipkart_reviews (pid);
  CREATE INDEX flipkart_reviews_review_date ON "DataWarehouse".flipkart_reviews (review_date);
  CREATE INDEX flipkart_reviews_pid_review_date ON "DataWarehouse".flipkart_reviews (pid, review_date);
`;

const MYNTRA_DDL = `
  CREATE TABLE "DataWarehouse".myntra_reviews (
    id                  SERIAL PRIMARY KEY,
    product_id          INTEGER NOT NULL,
    brand_name          TEXT NOT NULL,
    review_id           TEXT NOT NULL,
    rating              SMALLINT NOT NULL,
    title               TEXT,
    body                TEXT,
    review_date         DATE NOT NULL,
    reviewed_at         TIMESTAMPTZ,
    author_name         TEXT,
    helpful_count       INTEGER DEFAULT 0,
    not_helpful_count   INTEGER DEFAULT 0,
    has_images          BOOLEAN DEFAULT false,
    image_urls          TEXT[],
    size_purchased      TEXT,
    color_purchased     TEXT,
    product_url         TEXT,
    country             TEXT DEFAULT 'India',
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, review_id)
  );
  CREATE INDEX myntra_reviews_product_id ON "DataWarehouse".myntra_reviews (product_id);
  CREATE INDEX idx_myntra_reviews_review_date ON "DataWarehouse".myntra_reviews (review_date);
`;

// ── In-process validation of hash/mapper/canonical-ID behavior ─────────────────
function validateHashBehavior(sampleFlipkart: RawFlipkartReview, sampleMyntra: RawMyntraReview): string[] {
  const results: string[] = [];

  const fk1 = computeContentHash(mapFlipkartReview(sampleFlipkart));
  const fk2 = computeContentHash(mapFlipkartReview({ ...sampleFlipkart }));
  results.push(`[${fk1 === fk2 ? "PASS" : "FAIL"}] identical Flipkart review -> identical content_hash`);

  const fkTouched = { ...sampleFlipkart, updatedAt: new Date() };
  const fk3 = computeContentHash(mapFlipkartReview(fkTouched));
  results.push(`[${fk1 === fk3 ? "PASS" : "FAIL"}] updatedAt-only change -> content_hash unchanged (Flipkart)`);

  const fkRatingChanged = { ...sampleFlipkart, rating: sampleFlipkart.rating === 5 ? 1 : 5 };
  const fk4 = computeContentHash(mapFlipkartReview(fkRatingChanged));
  results.push(`[${fk1 !== fk4 ? "PASS" : "FAIL"}] rating change -> content_hash changes (Flipkart)`);

  const fkTextChanged = { ...sampleFlipkart, comment: `${sampleFlipkart.comment ?? ""} edited.` };
  const fk5 = computeContentHash(mapFlipkartReview(fkTextChanged));
  results.push(`[${fk1 !== fk5 ? "PASS" : "FAIL"}] review text change -> content_hash changes (Flipkart)`);

  const my1 = computeContentHash(mapMyntraReview(sampleMyntra));
  const myTouched = { ...sampleMyntra, updatedAt: new Date() };
  const my2 = computeContentHash(mapMyntraReview(myTouched));
  results.push(`[${my1 === my2 ? "PASS" : "FAIL"}] updatedAt-only change -> content_hash unchanged (Myntra)`);

  const myHelpfulChanged = { ...sampleMyntra, helpful_count: (sampleMyntra.helpful_count ?? 0) + 7 };
  const my3 = computeContentHash(mapMyntraReview(myHelpfulChanged));
  results.push(`[${my1 !== my3 ? "PASS" : "FAIL"}] helpful_count change -> content_hash changes (Myntra, meaningful-field case)`);

  const fkCanon = computeCanonicalReviewId("flipkart", "SAME_ID", "SAME_ID");
  const myCanon = computeCanonicalReviewId("myntra", "SAME_ID", "SAME_ID");
  results.push(
    `[${fkCanon !== myCanon ? "PASS" : "FAIL"}] identical (sourceProductId, sourceReviewId) on different platforms -> different canonical_review_id`,
  );

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  assertLocalMigrationTarget(config.appStore.host);

  const client = new Client({
    host: config.appStore.host,
    port: config.appStore.port,
    database: config.appStore.database,
    user: config.appStore.user,
    password: config.appStore.password,
  });
  await client.connect();

  try {
    console.log(`Connected to local ${config.appStore.host}:${config.appStore.port}/${config.appStore.database} (appStore config — production was never touched).`);

    const fkInspect = await inspectTable(client, "flipkart_reviews");
    const myInspect = await inspectTable(client, "myntra_reviews");

    if (fkInspect.exists || myInspect.exists) {
      console.log("\nSTOP — one or both target tables already exist. Not creating or inserting anything.");
      console.log(`  DataWarehouse.flipkart_reviews: ${fkInspect.exists ? `EXISTS (${fkInspect.rowCount} rows)` : "does not exist"}`);
      console.log(`  DataWarehouse.myntra_reviews:   ${myInspect.exists ? `EXISTS (${myInspect.rowCount} rows)` : "does not exist"}`);
      console.log("\nPer safety rules: do not delete/modify existing data. Waiting for explicit approval on how to proceed.");
      process.exitCode = 1;
      return;
    }

    console.log("Neither table exists yet. Creating schema objects (verified schema, same as src/database/fixtures/*.sql)...");
    await client.query(FLIPKART_DDL);
    await client.query(MYNTRA_DDL);
    console.log("Created DataWarehouse.flipkart_reviews and DataWarehouse.myntra_reviews.");

    console.log(`\nGenerating ${ROWS_PER_PLATFORM.toLocaleString()} Flipkart rows and ${ROWS_PER_PLATFORM.toLocaleString()} Myntra rows (seed=${SEED}, deterministic)...`);

    const fkStart = Date.now();
    const flipkartRows = buildFlipkartRows();
    await batchInsert(
      client,
      "flipkart_reviews",
      ["brand_name", "pid", "review_id", "rating", "title", "comment", "review_date", "product_url", "author_name", "verified_purchase", "helpful_count", "country", "createdAt", "updatedAt"],
      flipkartRows,
      BATCH_SIZE,
    );
    const fkDurationMs = Date.now() - fkStart;

    const myStart = Date.now();
    const myntraRows = buildMyntraRows();
    await batchInsert(
      client,
      "myntra_reviews",
      ["product_id", "brand_name", "review_id", "rating", "title", "body", "review_date", "reviewed_at", "author_name", "helpful_count", "not_helpful_count", "has_images", "image_urls", "size_purchased", "color_purchased", "product_url", "country", "createdAt", "updatedAt"],
      myntraRows,
      BATCH_SIZE,
    );
    const myDurationMs = Date.now() - myStart;

    console.log("\n=== Insert performance ===");
    console.log(`Flipkart: ${flipkartRows.length.toLocaleString()} rows generated, ${flipkartRows.length.toLocaleString()} inserted, ${fkDurationMs}ms, ${Math.round((flipkartRows.length / fkDurationMs) * 1000).toLocaleString()} rows/sec`);
    console.log(`Myntra:   ${myntraRows.length.toLocaleString()} rows generated, ${myntraRows.length.toLocaleString()} inserted, ${myDurationMs}ms, ${Math.round((myntraRows.length / myDurationMs) * 1000).toLocaleString()} rows/sec`);

    // ── Validation ──────────────────────────────────────────────────────────
    console.log("\n=== Validation ===");

    const fkFinal = await inspectTable(client, "flipkart_reviews");
    const myFinal = await inspectTable(client, "myntra_reviews");
    console.log(`Flipkart final row count: ${fkFinal.rowCount} (expected ${ROWS_PER_PLATFORM}) -> ${fkFinal.rowCount === ROWS_PER_PLATFORM ? "PASS" : "FAIL"}`);
    console.log(`Myntra final row count:   ${myFinal.rowCount} (expected ${ROWS_PER_PLATFORM}) -> ${myFinal.rowCount === ROWS_PER_PLATFORM ? "PASS" : "FAIL"}`);

    const { rows: fkDupes } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (SELECT pid, review_id FROM "DataWarehouse".flipkart_reviews GROUP BY pid, review_id HAVING count(*) > 1) d`,
    );
    const { rows: myDupes } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (SELECT product_id, review_id FROM "DataWarehouse".myntra_reviews GROUP BY product_id, review_id HAVING count(*) > 1) d`,
    );
    console.log(`Flipkart duplicate (pid, review_id) pairs: ${fkDupes[0]!.n} -> ${fkDupes[0]!.n === "0" ? "PASS" : "FAIL"}`);
    console.log(`Myntra duplicate (product_id, review_id) pairs: ${myDupes[0]!.n} -> ${myDupes[0]!.n === "0" ? "PASS" : "FAIL"}`);

    const { rows: fkNulls } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "DataWarehouse".flipkart_reviews WHERE pid IS NULL OR review_id IS NULL OR rating IS NULL OR review_date IS NULL`,
    );
    const { rows: myNulls } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "DataWarehouse".myntra_reviews WHERE product_id IS NULL OR review_id IS NULL OR rating IS NULL OR review_date IS NULL`,
    );
    console.log(`Flipkart required-field NULLs: ${fkNulls[0]!.n} -> ${fkNulls[0]!.n === "0" ? "PASS" : "FAIL"}`);
    console.log(`Myntra required-field NULLs: ${myNulls[0]!.n} -> ${myNulls[0]!.n === "0" ? "PASS" : "FAIL"}`);

    const { rows: fkRatingRange } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "DataWarehouse".flipkart_reviews WHERE rating < 1 OR rating > 5`,
    );
    const { rows: myRatingRange } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "DataWarehouse".myntra_reviews WHERE rating < 1 OR rating > 5`,
    );
    console.log(`Flipkart out-of-range ratings: ${fkRatingRange[0]!.n} -> ${fkRatingRange[0]!.n === "0" ? "PASS" : "FAIL"}`);
    console.log(`Myntra out-of-range ratings: ${myRatingRange[0]!.n} -> ${myRatingRange[0]!.n === "0" ? "PASS" : "FAIL"}`);

    console.log("\n--- review_date distribution (Flipkart) ---");
    const { rows: fkDateDist } = await client.query(
      `SELECT
         count(*) FILTER (WHERE review_date >= current_date - 30) AS d0_30,
         count(*) FILTER (WHERE review_date < current_date - 30 AND review_date >= current_date - 60) AS d31_60,
         count(*) FILTER (WHERE review_date < current_date - 60 AND review_date >= current_date - 90) AS d61_90,
         count(*) FILTER (WHERE review_date < current_date - 90 AND review_date >= current_date - 180) AS d3_6mo,
         count(*) FILTER (WHERE review_date < current_date - 180) AS d6_12mo
       FROM "DataWarehouse".flipkart_reviews`,
    );
    console.log(fkDateDist[0]);

    console.log("\n--- rating distribution (Flipkart) ---");
    const { rows: fkRatingDist } = await client.query(
      `SELECT rating, count(*) FROM "DataWarehouse".flipkart_reviews GROUP BY rating ORDER BY rating`,
    );
    console.table(fkRatingDist);

    console.log("--- rating distribution (Myntra) ---");
    const { rows: myRatingDist } = await client.query(
      `SELECT rating, count(*) FROM "DataWarehouse".myntra_reviews GROUP BY rating ORDER BY rating`,
    );
    console.table(myRatingDist);

    const { rows: fkProductDist } = await client.query<{ distinct_products: string; min_reviews: string; max_reviews: string }>(
      `SELECT count(DISTINCT pid)::text AS distinct_products, min(c)::text AS min_reviews, max(c)::text AS max_reviews
       FROM (SELECT pid, count(*) c FROM "DataWarehouse".flipkart_reviews GROUP BY pid) t`,
    );
    console.log(`\nFlipkart product distribution: ${fkProductDist[0]!.distinct_products} distinct pids, ${fkProductDist[0]!.min_reviews}-${fkProductDist[0]!.max_reviews} reviews/product`);

    const { rows: fkUpdatedRecent } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "DataWarehouse".flipkart_reviews WHERE "updatedAt"::date > review_date + interval '10 days'`,
    );
    console.log(`Flipkart rows where updatedAt is meaningfully newer than review_date (simulated re-upsert): ${fkUpdatedRecent[0]!.n}`);

    // Pull one real row per platform back and run it through the actual mapper/hash code.
    const { rows: fkSampleRows } = await client.query<RawFlipkartReview>(
      `SELECT id, pid, review_id, brand_name, rating, title, comment, review_date, product_url, author_name, verified_purchase, helpful_count, country, "updatedAt" FROM "DataWarehouse".flipkart_reviews LIMIT 1`,
    );
    const { rows: mySampleRows } = await client.query<RawMyntraReview>(
      `SELECT id, product_id, review_id, brand_name, rating, title, body, review_date, reviewed_at, author_name, helpful_count, not_helpful_count, has_images, image_urls, size_purchased, color_purchased, product_url, country, "updatedAt" FROM "DataWarehouse".myntra_reviews LIMIT 1`,
    );

    console.log("\n--- content_hash / mapper / canonical-ID validation (in-process, against real seeded rows) ---");
    for (const line of validateHashBehavior(fkSampleRows[0]!, mySampleRows[0]!)) {
      console.log(line);
    }

    console.log("\n=== Confirmation ===");
    console.log("PRODUCTION DATABASE ACCESSED: NO");
    console.log("PRODUCTION TABLES MODIFIED: NONE");
    console.log("PRODUCTION TABLES CREATED: NONE");
    console.log("PRODUCTION DATA MODIFIED: NONE");
    console.log(`All connections in this script used config.appStore (${config.appStore.host}:${config.appStore.port}/${config.appStore.database}) only.`);
  } finally {
    await client.end();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
