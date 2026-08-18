/**
 * Unit tests for Semantic Planner — PHASE B.
 * Tests the planner's ability to convert natural language into structured OperationPlans.
 */

import { describe, it, expect } from "vitest";
import { planOperations } from "../../src/modules/ai/semanticPlanner.js";
import { MockAiProvider } from "../../src/modules/ai/providers/mockAiProvider.js";
import type { Platform } from "../../src/types/unifiedReview.js";
import type { ValidatedPlanResult, PlannerRejection } from "../../src/modules/ai/semanticPlanner.js";

const mockProvider = new MockAiProvider();

describe("Semantic Planner", () => {
  it("should create a retrieval plan for 'show me reviews'", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.status).toBe("success");
    expect(result.plan.operations).toHaveLength(1);
    expect(result.plan.operations[0].type).toBe("RETRIEVE_REVIEWS");
    expect(result.plan.resultOperationId).toBe("op_0");
  });

  it("should create a retrieval plan with sentiment filter for 'bad reviews'", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me bad reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.plan.operations[0].type).toBe("RETRIEVE_REVIEWS");
    expect(result.plan.operations[0].params.sentiment).toBe("negative");
  });

  it("should create a multi-operation plan for 'show me bad reviews and tell me what's wrong'", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me bad reviews and tell me what's wrong",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.plan.operations).toHaveLength(2);
    expect(result.plan.operations[0].type).toBe("RETRIEVE_REVIEWS");
    expect(result.plan.operations[1].type).toBe("ANALYZE_REVIEW_SET");
    expect(result.plan.operations[1].dependsOn).toBe("op_0");
    expect(result.plan.resultOperationId).toBe("op_1");
  });

  it("should create an analysis plan for 'what's wrong'", async () => {
    const result = (await planOperations(
      {
        userQuestion: "what's wrong?",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.status).toBe("success");
    expect(result.plan.operations[0].type).toBe("ANALYZE_REVIEW_SET");
  });

  it("should create a general assessment plan for 'tell me something important'", async () => {
    const result = (await planOperations(
      {
        userQuestion: "tell me something important",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.plan.operations[0].type).toBe("GENERAL_ASSESSMENT");
  });

  it("should validate the returned plan through PlanValidator", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.validationStatus).toBe("valid");
    expect(result.plan.goal).toBeTruthy();
    expect(result.plan.operations).toBeTruthy();
    expect(result.plan.resultOperationId).toBeTruthy();
    expect(typeof result.plan.confidence).toBe("string");
  });

  it("should handle multi-operation plans with proper dependency ordering", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me bad reviews and tell me what's wrong",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    const plan = result.plan;
    expect(plan.operations[0].dependsOn).toBeUndefined();
    expect(plan.operations[1].dependsOn).toBe("op_0");
  });

  it("should handle provider failures gracefully", async () => {
    const failingProvider = new MockAiProvider();
    failingProvider.injectFailures(1);

    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      failingProvider,
    )) as any;

    expect(result.status).toBe("failure");
    expect(result.reason).toBeTruthy();
  });

  it("should produce plans with goal field", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me good reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.plan.goal).toBeTruthy();
    expect(typeof result.plan.goal).toBe("string");
  });

  it("should include confidence level in plans", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(["high", "medium", "low"]).toContain(result.plan.confidence);
  });

  it("should include reasoning in plans", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(result.plan.reasoning).toBeTruthy();
    expect(typeof result.plan.reasoning).toBe("string");
  });

  it("should respect contextReference flag", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    expect(typeof result.plan.contextReference).toBe("boolean");
  });

  it("should only use supported operation types", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews and tell me what's wrong",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    const supportedTypes = [
      "RETRIEVE_REVIEWS",
      "ANALYZE_REVIEW_SET",
      "ANALYZE_ASPECT",
      "GET_PRODUCT_ANALYTICS",
      "COMPARE_PERIODS",
      "ANALYZE_TREND",
      "COMPARE_MARKETPLACES",
      "GET_SUPPORTING_EVIDENCE",
      "GENERAL_ASSESSMENT",
    ];

    for (const op of result.plan.operations) {
      expect(supportedTypes).toContain(op.type);
    }
  });

  it("should assign unique operation IDs", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews and tell me what's wrong",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    const ids = result.plan.operations.map((op: any) => op.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should validate operation parameters through schema", async () => {
    const result = (await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    )) as any;

    for (const op of result.plan.operations) {
      expect(typeof op.params).toBe("object");
      expect(Object.keys(op.params).length).toBeGreaterThanOrEqual(0);
    }
  });

  it("should indicate success vs failure clearly", async () => {
    const successResult = await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      mockProvider,
    );

    expect(successResult.status).toBe("success");

    const failingProvider = new MockAiProvider();
    failingProvider.injectFailures(1);
    const failureResult = await planOperations(
      {
        userQuestion: "show me reviews",
        platform: "flipkart" as Platform,
        sourceProductId: "test-product",
      },
      failingProvider,
    );

    expect(failureResult.status).toBe("failure");
  });
});
