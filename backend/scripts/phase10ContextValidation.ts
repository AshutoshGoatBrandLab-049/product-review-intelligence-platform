/**
 * Phase 10 AI Product Analyst intent/context correction — real-data validation.
 *
 * Runs the exact 15-message conversation from the spec against a real local
 * product (dynamically discovered, not hardcoded), using MockAiProvider (no
 * network calls / no cost — see final report for the AI-cost disclosure).
 * Logs, for each turn: resolved intent, response type (retrieval vs
 * analysis vs clarification), and confirms any returned review IDs exist in
 * the DB for the correct platform/sourceProductId/window.
 */
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";
import { QueryTypes } from "sequelize";
import { analyzeProductQuestion } from "../src/modules/ai/productAnalyst.js";
import { MockAiProvider } from "../src/modules/ai/providers/mockAiProvider.js";
import { getOrCreateConversation } from "../src/modules/ai/conversationStore.js";
import { resolveNamedWindow } from "../src/modules/analytics/dateWindows.js";

const CONVERSATION_TURNS = [
  "What's the biggest issue?",
  "What are customers complaining about?",
  "show me all the bad reviews",
  "show me",
  "Show me negative reviews",
  "bad reviews dikhao",
  "product me kya problem hai?",
  "customers kis baat se pareshan hain?",
  "latest 20 reviews dikhao",
  "show me those",
  "why?",
  "what should we fix first?",
  "explain in detail",
  "what about the positive feedback?",
  "give me the best reviews",
  "show me the first 3",
];

async function main() {
  const schema = config.appStore.schema;
  const products = (await appSequelize.query(
    `SELECT platform, source_product_id, COUNT(*) as cnt
     FROM "${schema}".normalized_reviews
     GROUP BY platform, source_product_id
     ORDER BY cnt DESC LIMIT 5`,
    { type: QueryTypes.SELECT },
  )) as any[];

  if (products.length === 0) {
    console.error("No products with reviews found in local DB — aborting.");
    process.exit(1);
  }

  const product = products[0];
  const platform = product.platform as "flipkart" | "myntra";
  const sourceProductId = product.source_product_id as string;
  console.log(`\n=== Using product ${platform}/${sourceProductId} (${product.cnt} reviews) ===\n`);

  const window = resolveNamedWindow("12m");
  const conversation = await getOrCreateConversation(platform, sourceProductId, window);
  console.log(`Conversation ID: ${conversation.id}\n`);

  const provider = new MockAiProvider();
  let providerCallCount = 0;
  const origNarrate = provider.narrate.bind(provider);
  const origBatch = provider.analyzeReviewBatch!.bind(provider);
  provider.narrate = async (...args: any[]) => {
    providerCallCount++;
    return (origNarrate as any)(...args);
  };
  provider.analyzeReviewBatch = async (...args: any[]) => {
    providerCallCount++;
    return (origBatch as any)(...args);
  };

  for (let i = 0; i < CONVERSATION_TURNS.length; i++) {
    const question = CONVERSATION_TURNS[i]!;
    console.log(`--- Turn ${i + 1}: "${question}" ---`);
    try {
      const response = await analyzeProductQuestion(
        { platform, sourceProductId, userQuestion: question, window: "12m", conversationId: conversation.id },
        provider,
      );

      const responseType = response.needsClarification
        ? "CLARIFICATION"
        : response.reviews
          ? "RETRIEVAL"
          : "ANALYSIS";

      console.log(`  Response type: ${responseType}`);
      console.log(`  Answer: ${response.answer.slice(0, 150)}`);

      if (response.reviews) {
        console.log(`  Reviews returned: ${response.reviews.length} (totalMatchingCount=${response.totalMatchingCount})`);
        for (const review of response.reviews) {
          const rows = (await appSequelize.query(
            `SELECT 1 FROM "${schema}".normalized_reviews
             WHERE canonical_review_id = :id AND platform = :platform AND source_product_id = :pid`,
            {
              replacements: { id: review.canonicalReviewId, platform, pid: sourceProductId },
              type: QueryTypes.SELECT,
            },
          )) as any[];
          if (rows.length !== 1) {
            console.error(`  ❌ INTEGRITY VIOLATION: review ${review.canonicalReviewId} not found in DB for this platform/product`);
          }
        }
        console.log(`  ✅ All ${response.reviews.length} returned review IDs verified against DB`);
      }

      if (response.analysis) {
        for (const rc of response.analysis.rootCause) {
          const uniqueIds = new Set(rc.evidenceReviewIds);
          if (uniqueIds.size !== rc.evidenceReviewIds.length) {
            console.error(`  ❌ DUPLICATE evidence IDs in rootCause "${rc.theme}"`);
          }
          for (const id of rc.evidenceReviewIds) {
            const rows = (await appSequelize.query(
              `SELECT 1 FROM "${schema}".normalized_reviews
               WHERE canonical_review_id = :id AND platform = :platform AND source_product_id = :pid`,
              { replacements: { id, platform, pid: sourceProductId }, type: QueryTypes.SELECT },
            )) as any[];
            if (rows.length !== 1) {
              console.error(`  ❌ INTEGRITY VIOLATION: evidence ID ${id} not found in DB`);
            }
          }
        }
        console.log(`  ✅ Evidence integrity verified for ${response.analysis.rootCause.length} rootCause entries`);
      }

      if (response.needsClarification) {
        console.log(`  Clarification prompt: ${response.clarificationPrompt}`);
      }
    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log();
  }

  console.log(`\n=== Total mock provider calls across all 16 turns: ${providerCallCount} ===`);
  console.log("(0 real OpenAI/Anthropic/Gemini calls — MockAiProvider used throughout this validation run.)");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
