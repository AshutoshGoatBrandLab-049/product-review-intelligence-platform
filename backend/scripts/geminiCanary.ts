import { createAiProvider } from "../src/modules/ai/providers/providerFactory.js";
import { validateAiOutput } from "../src/modules/ai/validation.js";
import { isMainModule } from "../src/shared/isMainModule.js";

/**
 * Phase 4.1 Step 3 — ONE real provider call against ONE synthetic review,
 * never a real customer review. Proves auth/connectivity/structured-output/
 * validation only. Never persists anything, never touches the database.
 */
const SYNTHETIC_REVIEW = {
  canonicalReviewId: "synthetic-canary-not-a-real-review",
  rating: 2,
  title: "Poor quality",
  reviewText: "The material feels weak and the stitching came apart after a few uses.",
};

async function main(): Promise<void> {
  const provider = createAiProvider();
  console.log(`Provider: ${provider.name}, model: ${provider.modelVersion}`);

  const startedAt = Date.now();
  try {
    const rawOutput = await provider.analyzeReview(SYNTHETIC_REVIEW);
    const latencyMs = Date.now() - startedAt;

    const validation = validateAiOutput(rawOutput);

    console.log(JSON.stringify({
      success: true,
      provider: provider.name,
      modelVersion: provider.modelVersion,
      latencyMs,
      rawOutput,
      structuredOutputValid: validation.valid,
      validationErrors: validation.valid ? null : validation.errors,
    }, null, 2));

    if (!validation.valid) process.exitCode = 1;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    console.log(JSON.stringify({
      success: false,
      provider: provider.name,
      modelVersion: provider.modelVersion,
      latencyMs,
      error: (err as Error).message,
    }, null, 2));
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  main().then(() => process.exit(process.exitCode ?? 0));
}
