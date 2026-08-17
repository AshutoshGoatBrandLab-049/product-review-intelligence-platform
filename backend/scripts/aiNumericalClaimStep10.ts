import { GoogleGenAI } from "@google/genai";
import { config } from "../src/config/index.js";
import { appSequelize } from "../src/database/appStore/client.js";
import { buildProductEvidencePackage } from "../src/modules/ai/evidencePackage.js";
import { narrateProductEvidence } from "../src/modules/ai/narrator.js";
import { NARRATOR_RESPONSE_SCHEMA } from "../src/modules/ai/providers/geminiProvider.js";
import { resolveNamedWindow } from "../src/modules/analytics/dateWindows.js";
import type { AiProvider } from "../src/modules/ai/providers/aiProvider.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 10 — numerical-claim validation, sparse-AI-evidence edge
 * case. Step 9 already proved one real claim traces exactly to a deterministic
 * evidence-package field, on a well-populated product (296 reviews, 37
 * classified). The stronger, more informative test is the opposite case: a
 * real product with plenty of REVIEWS but ZERO AI classification
 * (sentimentDistribution=null, topThemes=[]) — the exact condition under
 * which a model would be most tempted to fabricate a sentiment/theme number
 * that doesn't exist rather than correctly reporting an absence of AI data.
 * Exactly ONE real Gemini call. Evidence-package build and narrator
 * validation are both read-only (confirmed by source inspection in Step 9,
 * unchanged code paths reused here).
 */
const PLATFORM = "myntra";
const SOURCE_PRODUCT_ID = "100293"; // 295 real reviews, 0 classified — genuine sparse-AI-evidence case
const WINDOW = resolveNamedWindow("12m");

async function main(): Promise<void> {
  if (config.ai.provider !== "gemini") {
    throw new Error(`AI_PROVIDER is "${config.ai.provider}", expected "gemini" — refusing to run.`);
  }
  if (!config.ai.geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured.");
  }

  const pkg = await buildProductEvidencePackage(PLATFORM, SOURCE_PRODUCT_ID, WINDOW);

  const client = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
  const model = config.ai.geminiModel;
  const modelVersion = `gemini:${model}:analysis-v1`;

  const startedAt = Date.now();
  const response = await client.models.generateContent({
    model,
    contents:
      `Explain the following product review evidence. Use language like ` +
      `"Reviews indicate..." or "Among the analyzed reviews...". Never claim ` +
      `sales causality reviews alone cannot prove. Every root-cause and ` +
      `recommendation must cite canonical_review_id values ONLY from the ` +
      `evidenceReviewIds list below — never invent an ID.\n\n` +
      JSON.stringify(pkg, null, 2),
    config: {
      responseMimeType: "application/json",
      responseSchema: NARRATOR_RESPONSE_SCHEMA,
    },
  });
  const latencyMs = Date.now() - startedAt;
  const usage = response.usageMetadata;

  const text = response.text;
  const rawOutput = text ? JSON.parse(text) : null;

  const replayProvider: AiProvider = {
    name: "gemini-replay-captured",
    modelVersion,
    analyzeReview: async () => {
      throw new Error("not used in this script");
    },
    narrate: async () => rawOutput,
  };

  let narratorResult: Awaited<ReturnType<typeof narrateProductEvidence>> | null = null;
  let validationError: string | null = null;
  try {
    narratorResult = await narrateProductEvidence(pkg, replayProvider);
  } catch (err) {
    validationError = (err as Error).message;
  }

  // Scan every string field in the narrator output for digit sequences —
  // deterministic, not a judgment call — so no numeric claim is missed.
  const numberPattern = /\d[\d.,]*%?/g;
  const textFields: string[] = [];
  if (narratorResult) {
    textFields.push(narratorResult.summary);
    for (const rc of narratorResult.rootCause) textFields.push(rc.explanation);
    for (const r of narratorResult.recommendations) textFields.push(r.reason);
  }
  const numericClaimsFound = textFields.flatMap((t) => t.match(numberPattern) ?? []);

  console.log(
    JSON.stringify(
      {
        evidencePackage: {
          platform: pkg.platform,
          sourceProductId: pkg.sourceProductId,
          window: pkg.window,
          reviewCount: pkg.reviewCount,
          averageRating: pkg.averageRating,
          positivePercentage: pkg.positivePercentage,
          negativePercentage: pkg.negativePercentage,
          sentimentDistribution: pkg.sentimentDistribution,
          topThemes: pkg.topThemes,
          topNegativeThemes: pkg.topNegativeThemes,
          evidenceReviewIdsCount: pkg.evidenceReviewIds.length,
          totalMatchingNegativeCount: pkg.totalMatchingNegativeCount,
        },
        realGeminiCall: { model, latencyMs },
        tokenUsage: usage
          ? {
              promptTokenCount: usage.promptTokenCount ?? null,
              candidatesTokenCount: usage.candidatesTokenCount ?? null,
              thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
              totalTokenCount: usage.totalTokenCount ?? null,
            }
          : { measured: false },
        schemaValidation: validationError ? { valid: false, error: validationError } : { valid: true },
        numericClaimsFoundInOutputText: numericClaimsFound,
        narratorResult,
      },
      null,
      2,
    ),
  );

  if (validationError) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => appSequelize.close())
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
