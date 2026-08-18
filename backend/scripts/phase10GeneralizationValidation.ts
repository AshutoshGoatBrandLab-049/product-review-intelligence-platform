/**
 * Phase 10 round-5 (post round-4) generalization validation.
 *
 * Runs a held-out set of paraphrases (authored independently of round 4's
 * test suite) through the REAL end-to-end analyzeProductQuestion() pipeline
 * with a REAL OpenAI provider (config.ai.provider === "openai" per .env),
 * against a real local product with real review data. For every query it
 * records: resolved action/kind, resolvedViaFallback, response type, and
 * cross-checks any returned review IDs against normalized_reviews directly.
 *
 * DEBUG_QUERY_RESOLUTION=true is set so productAnalyst.ts logs
 * `[queryResolution] {...}` (debugResolvedQuery output) for every call —
 * this script intercepts console.log to capture that line without adding
 * any extra LLM calls or duplicating resolution logic.
 */
process.env.DEBUG_QUERY_RESOLUTION = "true";

import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { QueryTypes } from "sequelize";
import { analyzeProductQuestion } from "../src/modules/ai/productAnalyst.js";
import { createAiProvider } from "../src/modules/ai/providers/providerFactory.js";
import { getOrCreateConversation } from "../src/modules/ai/conversationStore.js";
import { kindForAction, type QueryAction } from "../src/modules/ai/queryResolution.js";

const PLATFORM = "flipkart" as const;
const SOURCE_PRODUCT_ID = "FKPID000251";

let windowCounter = 0;
function freshWindow() {
  windowCounter++;
  // DATE columns — vary the year to guarantee a brand-new conversation row
  // (getOrCreateConversation is keyed on platform+sourceProductId+window),
  // so every independent test gets a conversation with NO pre-existing
  // messages / no context bleed from a previous unrelated test.
  const year = 1900 + windowCounter;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

async function freshConversationId(): Promise<string> {
  const conv = await getOrCreateConversation(PLATFORM, SOURCE_PRODUCT_ID, freshWindow() as any);
  return conv.id;
}

function captureResolutionLog<T>(fn: () => Promise<T>): Promise<{ result: T; resolution: any }> {
  const orig = console.log;
  let captured: any = null;
  console.log = (...args: any[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[queryResolution]")) {
      try {
        captured = JSON.parse(args[1] ?? args[0].replace("[queryResolution]", "").trim());
      } catch {
        // best-effort
      }
    }
    orig(...args);
  };
  return fn()
    .then((result) => {
      console.log = orig;
      return { result, resolution: captured };
    })
    .catch((err) => {
      console.log = orig;
      throw err;
    });
}

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

const provider = createAiProvider();
console.log(`\n=== AI provider in use: ${provider.name} (must be "openai" for this validation) ===\n`);

interface RunRecord {
  group: string;
  n: number | string;
  question: string;
  action: string | null;
  kind: string | null;
  resolvedViaFallback: boolean | null;
  contextReference: boolean | null;
  responseType: string;
  reviewCount: number;
  totalMatchingCount: number | undefined;
  dbVerified: boolean;
  missingIds: string[];
  answerSnippet: string;
  error?: string;
}

const records: RunRecord[] = [];
let apiCallEstimate = 0;

async function runQuery(
  group: string,
  n: number | string,
  question: string,
  conversationId: string,
): Promise<RunRecord> {
  apiCallEstimate++; // resolveQuery call, always happens
  try {
    const { result: response, resolution } = await captureResolutionLog(() =>
      analyzeProductQuestion({ platform: PLATFORM, sourceProductId: SOURCE_PRODUCT_ID, userQuestion: question, conversationId }, provider),
    );

    const responseType = (response as any).needsClarification
      ? "CLARIFICATION"
      : (response as any).reviews
        ? "RETRIEVAL"
        : (response as any).analysis
          ? "ANALYSIS"
          : "UNKNOWN";

    if (responseType === "ANALYSIS") apiCallEstimate++; // narrate() call (+ maybe analyzeReviewBatch)

    const reviewIds = (response as any).reviews?.map((r: any) => r.canonicalReviewId) ?? [];
    const check = await reviewIdsExistInDb(reviewIds);

    const record: RunRecord = {
      group,
      n,
      question,
      action: resolution?.action ?? null,
      kind: resolution?.action ? kindForAction(resolution.action as QueryAction) : null,
      resolvedViaFallback: resolution?.resolvedViaFallback ?? null,
      contextReference: resolution?.contextReference ?? null,
      responseType,
      reviewCount: reviewIds.length,
      totalMatchingCount: (response as any).totalMatchingCount,
      dbVerified: check.ok,
      missingIds: check.missing,
      answerSnippet: ((response as any).answer ?? "").slice(0, 180),
    };
    // derive kind from action via same mapping productAnalyst uses (RETRIEVAL/ANALYSIS/etc.)
    records.push(record);
    console.log(`\n[${group}#${n}] "${question}"`);
    console.log(JSON.stringify(record, null, 2));
    return record;
  } catch (error) {
    const record: RunRecord = {
      group,
      n,
      question,
      action: null,
      kind: null,
      resolvedViaFallback: null,
      contextReference: null,
      responseType: "ERROR",
      reviewCount: 0,
      totalMatchingCount: undefined,
      dbVerified: false,
      missingIds: [],
      answerSnippet: "",
      error: error instanceof Error ? error.message : String(error),
    };
    records.push(record);
    console.error(`\n[${group}#${n}] "${question}" ERROR:`, record.error);
    return record;
  }
}

async function main() {
  // ---------------- Group 1 ----------------
  const g1 = [
    "what did people say most recently?",
    "can I see the newest customer feedback?",
    "bring up recent reviews",
    "mujhe recent feedback dikhao",
    "naye wale reviews dikha do",
    "what are the latest customers saying?",
  ];
  for (let i = 0; i < g1.length; i++) {
    await runQuery("Group1-LatestReviews", i + 1, g1[i]!, await freshConversationId());
  }

  // ---------------- Group 2 ----------------
  const g2 = [
    "pull up the ones where customers were unhappy",
    "I wanna see who didn't like it",
    "unsatisfied customers ke reviews kahan hain",
    "anything from people who regret buying this?",
    "surface the low-rating feedback",
    "jo log naraz the unka feedback dikhao",
  ];
  for (let i = 0; i < g2.length; i++) {
    await runQuery("Group2-NegativeReviews", i + 1, g2[i]!, await freshConversationId());
  }

  // ---------------- Group 3 ----------------
  const g3 = [
    "if this product had one flaw, what would it be?",
    "where does it fall short the most?",
    "iski sabse badi kami kya hai",
    "what's the number one thing people don't like?",
    "point out the weakest part of this product",
    "which complaint shows up more than any other?",
  ];
  for (let i = 0; i < g3.length; i++) {
    await runQuery("Group3-BiggestProblem", i + 1, g3[i]!, await freshConversationId());
  }

  // ---------------- Group 4 ----------------
  const g4 = [
    "what's bugging people about this?",
    "what gripes do customers have?",
    "logon ko kis baat se dikkat ho rahi hai",
    "give me a rundown of what's annoying buyers",
    "what keeps coming up in the negative feedback?",
    "what are the common gripes in the reviews?",
  ];
  for (let i = 0; i < g4.length; i++) {
    await runQuery("Group4-ComplaintThemes", i + 1, g4[i]!, await freshConversationId());
  }

  // ---------------- Group 5 ----------------
  const g5 = [
    "what's this product doing right?",
    "any highlights from happy customers?",
    "achhi baatein kya bata rahe hain log",
    "what wins people over about it?",
    "what's the good stuff people mention?",
    "what are buyers happy with here?",
  ];
  for (let i = 0; i < g5.length; i++) {
    await runQuery("Group5-PositiveFeedback", i + 1, g5[i]!, await freshConversationId());
  }

  // ---------------- Group 6 ----------------
  const g6 = [
    "what's one change that would help the most?",
    "where should the team focus to make this better?",
    "isko aur accha kaise banaye",
    "any low-hanging fruit to fix?",
    "what steps would raise customer satisfaction here?",
    "what would move the needle on ratings?",
  ];
  for (let i = 0; i < g6.length; i++) {
    await runQuery("Group6-Recommendations", i + 1, g6[i]!, await freshConversationId());
  }

  // ---------------- Group 7 ----------------
  const g7 = [
    "reviews since Monday",
    "just this past week's feedback",
    "pichle hafte ke reviews",
    "anything posted in the last couple of days?",
    "feedback from the newest batch of buyers",
    "reviews only from the most recent few days",
  ];
  for (let i = 0; i < g7.length; i++) {
    await runQuery("Group7-TimeframeRetrieval", i + 1, g7[i]!, await freshConversationId());
  }

  // ---------------- Group 8 (pronoun/contextual follow-up) ----------------
  const g8 = [
    "can you show them to me",
    "let's look at those",
    "wahi dikhao na",
    "pull those examples up",
    "I'd like to see the ones behind that",
    "show me the proof",
  ];
  for (let i = 0; i < g8.length; i++) {
    const conversationId = await freshConversationId();
    const priming = await runQuery("Group8-Priming", `${i + 1}p`, "what's the biggest issue?", conversationId);
    await runQuery("Group8-ContextualFollowup", i + 1, g8[i]!, conversationId);
  }

  // ---------------- Group 9 (explain-previous / why) ----------------
  const g9 = [
    "what makes you say that",
    "based on what",
    "kaise pata chala",
    "walk me through the reasoning",
    "what's backing that up",
    "justify that",
  ];
  for (let i = 0; i < g9.length; i++) {
    const conversationId = await freshConversationId();
    await runQuery("Group9-Priming", `${i + 1}p`, "what's the biggest issue?", conversationId);
    await runQuery("Group9-ExplainPrevious", i + 1, g9[i]!, conversationId);
  }

  // ---------------- Group 10 (adversarial near-pairs) ----------------
  const pairs: [string, string, string][] = [
    ["10a", "how do people feel about the packaging", "how do people feel about the packaging"],
    ["10a2", "show me reviews about the packaging", "show me reviews about the packaging"],
    ["10b", "is the rating dropping", "is the rating dropping"],
    ["10b2", "what's the rating right now", "what's the rating right now"],
    ["10c", "what should I fix first", "what should I fix first"],
    ["10c2", "what should I read first", "what should I read first"],
    ["10d", "recent complaints", "recent complaints"],
    ["10d2", "recent reviews", "recent reviews"],
  ];
  for (const [label, question] of pairs) {
    await runQuery("Group10-Adversarial", label, question, await freshConversationId());
  }

  console.log("\n\n=== SUMMARY ===");
  for (const r of records) {
    console.log(
      `[${r.group}#${r.n}] action=${r.action} fallback=${r.resolvedViaFallback} type=${r.responseType} reviews=${r.reviewCount} verified=${r.dbVerified}${r.error ? " ERROR:" + r.error : ""}`,
    );
  }
  console.log(`\nTotal analyzeProductQuestion() calls: ${records.length}`);
  console.log(`Estimated real OpenAI API calls (resolveQuery + narrate/batch where applicable): ~${apiCallEstimate}`);

  // Dump raw JSON for the report writer to consume.
  const fs = await import("node:fs");
  fs.writeFileSync(
    new URL("./_generalizationResults.json", import.meta.url),
    JSON.stringify({ records, apiCallEstimate }, null, 2),
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
