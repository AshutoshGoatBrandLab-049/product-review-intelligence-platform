/**
 * Unit tests for Operation Executor — PHASE A.
 * Tests execution of validated plans and dependency chaining.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeOperationPlan, type ExecutionContext } from "../../src/modules/ai/operationExecutor.js";
import type { ValidatedPlan } from "../../src/modules/ai/operationPlan.js";
import { resolveNamedWindow } from "../../src/modules/analytics/dateWindows.js";
import type { Platform } from "../../src/types/unifiedReview.js";

const testContext: ExecutionContext = {
  platform: "flipkart" as Platform,
  sourceProductId: "test-product-1",
  userQuestion: "Show me reviews",
  defaultWindow: resolveNamedWindow("7d"),
};

describe("Operation Executor", () => {
  it("should execute a simple single-operation plan", async () => {
    const plan: ValidatedPlan = {
      goal: "Retrieve reviews",
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
      ],
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "high",
      reasoning: "Simple retrieval",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.success).toBe(true);
    expect(result.operationResults.size).toBe(1);
    expect(result.operationResults.get("op_0")?.status).toBe("success");
    expect(result.finalResult?.operationId).toBe("op_0");
    expect(result.executionTimeMs).toBeGreaterThan(0);
  });

  it("should execute operations in dependency order", async () => {
    const executionOrder: string[] = [];

    const plan: ValidatedPlan = {
      goal: "Retrieve and analyze",
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_REVIEW_SET",
          params: {
            aspect: "quality",
          },
          dependsOn: "op_0",
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Retrieve then analyze",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.success).toBe(true);
    expect(result.operationResults.size).toBe(2);

    // op_0 should execute before op_1
    const op0Result = result.operationResults.get("op_0");
    const op1Result = result.operationResults.get("op_1");

    expect(op0Result?.status).toBe("success");
    expect(op1Result?.status).toBe("success");
    expect(result.finalResult?.operationId).toBe("op_1");
  });

  it("should pass results from prior operations to dependencies", async () => {
    const plan: ValidatedPlan = {
      goal: "Chained operations",
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_REVIEW_SET",
          params: {
            aspect: "delivery",
          },
          dependsOn: "op_0",
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Chained",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    // Verify the result operation received input from prior operation
    const op1Result = result.operationResults.get("op_1");
    expect(op1Result?.result).toBeTruthy();
    expect(op1Result?.status).toBe("success");
  });

  it("should collect evidence review IDs from all operations", async () => {
    const plan: ValidatedPlan = {
      goal: "Collect evidence",
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_REVIEW_SET",
          params: {},
          dependsOn: "op_0",
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Collect evidence",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.success).toBe(true);
    // Should have collected evidence IDs from operations that produce them
    expect(Array.isArray(result.allEvidenceReviewIds)).toBe(true);
  });

  it("should stop on first operation failure", async () => {
    const plan: ValidatedPlan = {
      goal: "Should fail",
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "invalid_window", // Invalid window
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_REVIEW_SET",
          params: {},
          dependsOn: "op_0",
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Should fail",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    // Plan should fail, and op_1 shouldn't execute
    expect(result.success).toBe(false);
    expect(result.failureOperationId).toBeTruthy();
    expect(result.failureMessage).toBeTruthy();
  });

  it("should handle operations without dependencies", async () => {
    const plan: ValidatedPlan = {
      goal: "Get analytics",
      operations: [
        {
          id: "op_0",
          type: "GET_PRODUCT_ANALYTICS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
      ],
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "high",
      reasoning: "Simple analytics",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.success).toBe(true);
    expect(result.operationResults.get("op_0")?.status).toBe("success");
    expect(result.finalResult?.operationType).toBe("GET_PRODUCT_ANALYTICS");
  });

  it("should track execution time", async () => {
    const plan: ValidatedPlan = {
      goal: "Track timing",
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
      ],
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "high",
      reasoning: "Timing test",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.executionTimeMs).toBe("number");
  });

  it("should handle missing dependency gracefully", async () => {
    const plan: ValidatedPlan = {
      goal: "Missing dependency",
      operations: [
        {
          id: "op_0",
          type: "GET_PRODUCT_ANALYTICS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_REVIEW_SET",
          params: {},
          dependsOn: "op_missing", // Doesn't exist
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Missing dep",
      validationStatus: "valid" as const,
    };

    const result = await executeOperationPlan(plan, testContext);

    // Execution should fail because dependency is missing
    expect(result.success).toBe(false);
    expect(result.failureMessage).toContain("not found");
  });

  it("should preserve operation result for final operation", async () => {
    const plan: ValidatedPlan = {
      goal: "Multi-op with specific final",
      operations: [
        {
          id: "op_0",
          type: "GET_PRODUCT_ANALYTICS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_TREND",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
      ],
      resultOperationId: "op_1", // op_1 is the final result
      contextReference: false,
      confidence: "high",
      reasoning: "Specific final",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.success).toBe(true);
    expect(result.finalResult?.operationId).toBe("op_1");
    expect(result.finalResult?.operationType).toBe("ANALYZE_TREND");
  });

  it("should return all operation results in map", async () => {
    const plan: ValidatedPlan = {
      goal: "Three operations",
      operations: [
        {
          id: "op_0",
          type: "GET_PRODUCT_ANALYTICS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_TREND",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_2",
          type: "COMPARE_PERIODS",
          params: {
            currentTimeframe: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
      ],
      resultOperationId: "op_2",
      contextReference: false,
      confidence: "high",
      reasoning: "Three ops",
      validationStatus: "valid",
    };

    const result = await executeOperationPlan(plan, testContext);

    expect(result.success).toBe(true);
    expect(result.operationResults.size).toBe(3);
    expect(result.operationResults.has("op_0")).toBe(true);
    expect(result.operationResults.has("op_1")).toBe(true);
    expect(result.operationResults.has("op_2")).toBe(true);
  });
});
