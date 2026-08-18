/**
 * DEBUG: Trace the complete integration chain
 * from semantic analysis through to final citations
 */

import { analyzeProductQuestion } from "../src/modules/ai/productAnalyst.js";
import { OpenAiProvider } from "../src/modules/ai/providers/openaiProvider.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { config } from "../src/config/index.js";

async function main() {
  console.log("\n=== INTEGRATION CHAIN DEBUG ===\n");

  const provider = new OpenAiProvider(config.ai.openaiApiKey, config.ai.openaiModel);

  try {
    const response = await analyzeProductQuestion(
      {
        platform: "flipkart",
        sourceProductId: "FKPID000001",
        userQuestion: "What's the biggest issue?",
        window: "30d",
      },
      provider,
    );

    console.log("SEMANTIC ANALYSIS RESULT:");
    console.log(JSON.stringify(response.analysis!.rootCause, null, 2));

    console.log("\n\nROOT CAUSE ANALYSIS:");
    for (const rc of response.analysis!.rootCause) {
      console.log(`\nTheme: "${rc.theme}"`);
      console.log(`  Explanation: ${rc.explanation.substring(0, 100)}...`);
      console.log(`  Evidence Review IDs (${rc.evidenceReviewIds.length}):`);
      rc.evidenceReviewIds.forEach((id, i) => {
        if (i < 5) console.log(`    [${i + 1}] ${id}`);
      });
      if (rc.evidenceReviewIds.length > 5) {
        console.log(`    ... and ${rc.evidenceReviewIds.length - 5} more`);
      }
    }

    console.log("\n\n=== QUESTION: Why is the citation count different from the answer? ===");
    console.log("The answer says the theme appeared 9 times,");
    console.log("but the evidence citations show only " + response.analysis!.rootCause[0]?.evidenceReviewIds.length + " IDs.\n");
  } catch (error) {
    console.error("ERROR:", error instanceof Error ? error.message : String(error));
    throw error;
  }

  await appSequelize.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
