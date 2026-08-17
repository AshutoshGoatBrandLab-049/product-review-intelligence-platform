import { GoogleGenAI } from "@google/genai";
import { config } from "../src/config/index.js";
import { validateAiOutput } from "../src/modules/ai/validation.js";
import { ANALYSIS_RESPONSE_SCHEMA } from "../src/modules/ai/providers/geminiProvider.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 8 — token/cost measurement. Exactly ONE real Gemini call
 * (the smallest scope that can produce real usage-metadata — no mock or unit
 * test can substitute, since token counts only exist on a real API
 * response), against the SAME synthetic, non-real-customer review already
 * used and approved for Step 3's canary. Never persists anything, never
 * touches any database, never runs through the pipeline — pure provider-level
 * measurement. Mirrors geminiProvider.ts's analyzeReview() call construction
 * exactly (same model, same schema, same prompt template) rather than
 * reimplementing a divergent one-off request shape.
 */
const SYNTHETIC_REVIEW = {
  canonicalReviewId: "synthetic-canary-not-a-real-review",
  rating: 2,
  title: "Poor quality",
  reviewText: "The material feels weak and the stitching came apart after a few uses.",
};

async function main(): Promise<void> {
  if (config.ai.provider !== "gemini") {
    throw new Error(`AI_PROVIDER is "${config.ai.provider}", expected "gemini" — refusing to run (would not measure real usage).`);
  }
  if (!config.ai.geminiApiKey) {
    throw new Error("GEMINI_API_KEY not configured.");
  }

  const client = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
  const model = config.ai.geminiModel;

  const startedAt = Date.now();
  const response = await client.models.generateContent({
    model,
    contents:
      `Analyze this product review.\n` +
      `Rating: ${SYNTHETIC_REVIEW.rating}/5\n` +
      `Title: ${SYNTHETIC_REVIEW.title}\n` +
      `Review: ${SYNTHETIC_REVIEW.reviewText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_RESPONSE_SCHEMA,
    },
  });
  const latencyMs = Date.now() - startedAt;

  const text = response.text;
  const rawOutput = text ? JSON.parse(text) : null;
  const validation = rawOutput ? validateAiOutput(rawOutput) : { valid: false as const, errors: ["no text content returned"] };

  const usage = response.usageMetadata;

  console.log(
    JSON.stringify(
      {
        provider: "gemini",
        model,
        modelVersionString: `gemini:${model}:analysis-v1`,
        latencyMs,
        structuredOutputValid: validation.valid,
        tokenUsage: usage
          ? {
              promptTokenCount: usage.promptTokenCount ?? null,
              candidatesTokenCount: usage.candidatesTokenCount ?? null,
              thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
              totalTokenCount: usage.totalTokenCount ?? null,
              measured: "PROVEN BY EXECUTION — read directly from response.usageMetadata, not estimated",
            }
          : { measured: false, note: "response.usageMetadata was absent on this response" },
        costNote:
          "This API key is on Gemini's FREE TIER (independently confirmed in Step 4 via a real 429 " +
          "'generate_content_free_tier_requests' quota error) — actual monetary cost of this call is " +
          "$0, OBSERVED, not estimated. Paid-tier-equivalent cost is NOT MEASURED here: this session " +
          "does not have verified, current Gemini per-token pricing and will not fabricate a rate — " +
          "if a paid-tier estimate is needed, compute it from the token counts above against the " +
          "current published Gemini API pricing page.",
      },
      null,
      2,
    ),
  );

  if (!validation.valid) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
