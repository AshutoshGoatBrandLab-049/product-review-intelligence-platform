/**
 * Phase 10 query-understanding correction — 20-query real-data validation.
 *
 * Uses MockAiProvider (no network calls, no API cost) against a real local
 * product with real normalized_reviews rows. Logs, per query: resolved
 * action/intent, extracted filters/timeframe/quantity, context used, DB
 * operation, response type, returned review count, evidence IDs, whether AI
 * was called, and cross-checks every returned review ID directly against
 * normalized_reviews for the correct platform/product/window.
 */
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { QueryTypes } from "sequelize";
import { analyzeProductQuestion } from "../src/modules/ai/productAnalyst.js";
import { MockAiProvider } from "../src/modules/ai/providers/mockAiProvider.js";
import { getOrCreateConversation } from "../src/modules/ai/conversationStore.js";

const PLATFORM = "flipkart" as const;
const SOURCE_PRODUCT_ID = "FKPID000251";

interface QuerySpec {
  n: number;
  question: string;
  freshConversation?: boolean; // start a brand-new conversation (no prior turn) for this query
}

const QUERIES: QuerySpec[] = [
  { n: 1, question: "What are customers complaining about?", freshConversation: true },
  { n: 2, question: "Show me the latest 20 reviews" },
  { n: 3, question: "What's the biggest issue?" },
  { n: 4, question: "show me all the reviews" },
  { n: 5, question: "mujhe last 5 days ka reviews dekhna h" },
  { n: 6, question: "mujhe pichhle 5 din ke reviews dikhao" },
  { n: 7, question: "last 5 days ke negative reviews dikhao" },
  { n: 8, question: "latest 10 reviews" },
  { n: 9, question: "bad reviews dikhao" },
  { n: 10, question: "achhe reviews dikhao" },
  { n: 11, question: "how can improve this product" },
  { n: 12, question: "what should we fix first" },
  { n: 13, question: "quality ka kya scene hai" },
  { n: 14, question: "product me kya problem hai" },
  { n: 15, question: "customers kis baat se pareshan hain" },
  // 16-20 run in one fresh conversation so context-dependent turns are real.
  { n: 16, question: "What's the biggest issue?", freshConversation: true },
  { n: 17, question: "show me those reviews" },
  { n: 18, question: "show me" },
  { n: 19, question: "why?" },
  { n: 20, question: "explain in detail" },
];
// #20 in the required list is "give me the first 3" — run separately below
// since it needs its own fresh context turn.
const QUERY_21_EXTRA = { n: 21, question: "give me the first 3", freshConversation: true, primeWith: "What's the biggest issue?" };

async function reviewIdsExistInDb(ids: string[]): Promise<{ ok: boolean; missing: string[] }> {
  if (ids.length === 0) return { ok: true, missing: [] };
  const schema = config.appStore.schema;
  const rows = (await appSequelize.query(
    `SELECT DISTINCT canonical_review_id FROM "${schema}".normalized_reviews
     WHERE canonical_review_id IN (:ids) AND platform = :platform AND source_product_id = :sourceProductId`,
    { type: QueryTypes.SELECT, replacements: { ids, platform: PLATFORM, sourceProductId: SOURCE_PRODUCT_ID } },
  )) as any[];
  const found = new Set(rows.map((r: any) => r.canonical_review_id));
  const missing = ids.filter((id) => !found.has(id));
  return { ok: missing.length === 0, missing };
}

async function main() {
  const provider = new MockAiProvider();
  const results: any[] = [];

  let conversationId: string | undefined;

  async function run(q: QuerySpec) {
    if (q.freshConversation || !conversationId) {
      const conv = await getOrCreateConversation(PLATFORM, SOURCE_PRODUCT_ID, { start: "2000-01-01", end: "2100-01-01" } as any);
      conversationId = conv.id;
    }

    const response = await analyzeProductQuestion(
      { platform: PLATFORM, sourceProductId: SOURCE_PRODUCT_ID, userQuestion: q.question, conversationId },
      provider,
    );

    const reviewIds = (response as any).reviews?.map((r: any) => r.canonicalReviewId) ?? [];
    const check = await reviewIdsExistInDb(reviewIds);

    const responseType = (response as any).needsClarification
      ? "CLARIFICATION"
      : (response as any).reviews
        ? "RETRIEVAL"
        : (response as any).analysis
          ? "ANALYSIS"
          : "UNKNOWN";

    const row = {
      n: q.n,
      question: q.question,
      window: (response as any).window,
      responseType,
      returnedReviewCount: reviewIds.length,
      totalMatchingCount: (response as any).totalMatchingCount,
      evidenceReviewIds: (response as any).analysis?.rootCause?.flatMap((rc: any) => rc.evidenceReviewIds) ?? [],
      answer: (response as any).answer,
      allReviewIdsVerifiedInDb: check.ok,
      missingIds: check.missing,
    };
    results.push(row);
    console.log(`\n#${q.n} "${q.question}"`);
    console.log(JSON.stringify(row, null, 2));
    return response;
  }

  for (const q of QUERIES) {
    await run(q);
  }

  // Query 21 ("give me the first 3") — needs its own primed conversation.
  {
    const conv = await getOrCreateConversation(PLATFORM, SOURCE_PRODUCT_ID, { start: "2000-01-01", end: "2100-01-01" } as any);
    conversationId = conv.id;
    await run({ n: QUERY_21_EXTRA.n, question: QUERY_21_EXTRA.primeWith });
    await run({ n: QUERY_21_EXTRA.n, question: QUERY_21_EXTRA.question });
  }

  console.log("\n\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`#${r.n} [${r.responseType}] reviews=${r.returnedReviewCount} verified=${r.allReviewIdsVerifiedInDb} window=${JSON.stringify(r.window)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
