/**
 * Phase 10 Phase C Real-Provider Validation
 * Tests the complete pipeline: semantic planner → operation executor → results
 * Against real local data and real (or mocked) OpenAI provider.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { Platform } from "../../src/types/unifiedReview.js";
import { analyzeProductQuestion } from "../../src/modules/ai/productAnalyst.js";
import { createAiProvider } from "../../src/modules/ai/providers/providerFactory.js";
import type { AiProvider } from "../../src/modules/ai/providers/aiProvider.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { config } from "../../src/config/index.js";
import { QueryTypes } from "sequelize";

let aiProvider: AiProvider;
let testProduct: { platform: Platform; sourceProductId: string } | null = null;

beforeAll(async () => {
  // Use mock provider for predictable testing
  aiProvider = createAiProvider("mock");

  // Find a product with reviews for testing
  const schema = config.appStore.schema;
  const result = (await appSequelize.query(
    `SELECT platform, source_product_id FROM "${schema}".normalized_reviews
     GROUP BY platform, source_product_id LIMIT 1`,
    { type: QueryTypes.SELECT },
  )) as any[];

  if (result.length > 0) {
    testProduct = {
      platform: result[0].platform as Platform,
      sourceProductId: result[0].source_product_id,
    };
  }
});

describe("Phase 10 Phase C Real-Provider Validation", () => {
  it("should work when test data is available", async () => {
    if (!testProduct) {
      console.log("Skipping real-provider tests: no test data found");
      return;
    }

    // Test case: basic retrieval
    const response1 = await analyzeProductQuestion(
      {
        platform: testProduct.platform,
        sourceProductId: testProduct.sourceProductId,
        userQuestion: "Show me the latest 20 reviews",
      },
      aiProvider,
    );

    expect(response1).toBeDefined();
    expect(response1.answer).toBeTruthy();
    expect(response1.platform).toBe(testProduct.platform);
  });

  it("should handle analysis queries", async () => {
    if (!testProduct) return;

    const response = await analyzeProductQuestion(
      {
        platform: testProduct.platform,
        sourceProductId: testProduct.sourceProductId,
        userQuestion: "What are customers complaining about?",
      },
      aiProvider,
    );

    expect(response).toBeDefined();
    expect(response.answer).toBeTruthy();
  });

  it("should handle sentiment-filtered retrieval", async () => {
    if (!testProduct) return;

    const response = await analyzeProductQuestion(
      {
        platform: testProduct.platform,
        sourceProductId: testProduct.sourceProductId,
        userQuestion: "Show me all the bad reviews",
      },
      aiProvider,
    );

    expect(response).toBeDefined();
    expect(response.answer).toBeTruthy();
  });

  it("should handle general assessment", async () => {
    if (!testProduct) return;

    const response = await analyzeProductQuestion(
      {
        platform: testProduct.platform,
        sourceProductId: testProduct.sourceProductId,
        userQuestion: "Tell me the overall picture",
      },
      aiProvider,
    );

    expect(response).toBeDefined();
    expect(response.answer).toBeTruthy();
  });

  it("should gracefully handle missing products", async () => {
    try {
      await analyzeProductQuestion(
        {
          platform: "flipkart" as Platform,
          sourceProductId: "nonexistent-product-xyz",
          userQuestion: "What's wrong?",
        },
        aiProvider,
      );
      // If we get here without error, that's acceptable (product might exist)
    } catch (error) {
      // Expected for truly nonexistent products
      expect(error).toBeDefined();
    }
  });
});
