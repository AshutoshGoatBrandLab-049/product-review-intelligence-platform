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
 * Phase 4.1 Step 9 — narrator validation with the real Gemini provider.
 * Exactly ONE real Gemini call: builds a real (read-only) evidence package
 * from the already-restored local dataset, makes one narrate() call, then
 * runs the captured output through the REAL, unmodified narrateProductEvidence()
 * validation path (schema + citation-rejection) via a "replay" provider that
 * returns the already-fetched output rather than calling the API again.
 * Zero writes: evidence-package building is pure SELECT, and no AI pipeline
 * (analyzeReview/persistence) is invoked at all.
 */
const PLATFORM = "flipkart";
const SOURCE_PRODUCT_ID = "FKPID000256"; // 37 classified reviews, 8 rating<=2, in the restored local dataset
const WINDOW = resolveNamedWindow("12m");

async function main(): Promise<void> {
  if (config.ai.provider !== "gemini") {
    throw new Error(`AI_PROVIDER is "${config.ai.provider}", expected "gemini" — refusing to run.`);
  }
  if (!config.ai.geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured.");
  }

  // ── Build a real, read-only evidence package (no writes) ───────────────
  const pkg = await buildProductEvidencePackage(PLATFORM, SOURCE_PRODUCT_ID, WINDOW);

  const client = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
  const model = config.ai.geminiModel;
  const modelVersion = `gemini:${model}:analysis-v1`;

  // ── The ONE real Gemini call, mirroring geminiProvider.ts's narrate() exactly ──
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

  // ── Run the REAL validation path (schema + citation-rejection) on the captured output — zero additional calls ──
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

  console.log(
    JSON.stringify(
      {
        evidencePackage: {
          platform: pkg.platform,
          sourceProductId: pkg.sourceProductId,
          window: pkg.window,
          reviewCount: pkg.reviewCount,
          averageRating: pkg.averageRating,
          sentimentDistribution: pkg.sentimentDistribution,
          topThemes: pkg.topThemes,
          topNegativeThemes: pkg.topNegativeThemes,
          evidenceReviewIdsCount: pkg.evidenceReviewIds.length,
          totalMatchingNegativeCount: pkg.totalMatchingNegativeCount,
        },
        realGeminiCall: {
          model,
          latencyMs,
          rawTextReturned: text !== undefined && text !== null,
        },
        tokenUsage: usage
          ? {
              promptTokenCount: usage.promptTokenCount ?? null,
              candidatesTokenCount: usage.candidatesTokenCount ?? null,
              thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
              totalTokenCount: usage.totalTokenCount ?? null,
            }
          : { measured: false, note: "response.usageMetadata absent" },
        schemaValidation: validationError ? { valid: false, error: validationError } : { valid: true },
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
