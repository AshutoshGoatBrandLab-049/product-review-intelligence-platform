/**
 * Unit tests for Plan Validator — PHASE A.
 * Tests deterministic safety checks for operation plans.
 */

import { describe, it, expect } from "vitest";
import { validatePlan } from "../../src/modules/ai/planValidator.js";
import type { OperationPlan } from "../../src/modules/ai/operationPlan.js";

describe("Plan Validator", () => {
  const validBasicPlan: OperationPlan = {
    goal: "Show me the latest reviews",
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
  };

  it("should validate a simple single-operation plan", () => {
    const result = validatePlan(validBasicPlan);
    expect(result.validationStatus).toBe("valid");
    expect("validationStatus" in result && result.validationStatus === "valid").toBe(true);
  });

  it("should reject unknown operation types", () => {
    const plan: OperationPlan = {
      ...validBasicPlan,
      operations: [
        {
          id: "op_0",
          type: "UNKNOWN_OPERATION",
          params: {},
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("unknown_operation");
  });

  it("should reject missing required parameters", () => {
    const plan: OperationPlan = {
      ...validBasicPlan,
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {}, // Missing required timeframeDescriptor
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("missing_required_parameter");
  });

  it("should reject invalid parameter types", () => {
    const plan: OperationPlan = {
      ...validBasicPlan,
      operations: [
        {
          id: "op_0",
          type: "RETRIEVE_REVIEWS",
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
            sentiment: "invalid_sentiment", // Invalid enum value
          },
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("invalid_parameter_type");
  });

  it("should reject non-existent result operation", () => {
    const plan: OperationPlan = {
      ...validBasicPlan,
      resultOperationId: "op_999", // Doesn't exist
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("invalid_result_operation");
  });

  it("should validate multi-operation plans with dependencies", () => {
    const plan: OperationPlan = {
      goal: "Get reviews and analyze them",
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
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("valid");
  });

  it("should reject impossible dependencies", () => {
    const plan: OperationPlan = {
      goal: "Bad dependency",
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
          dependsOn: "op_999", // Doesn't exist
        },
      ],
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "high",
      reasoning: "Bad",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("impossible_dependency");
  });

  it("should detect circular dependencies", () => {
    const plan: OperationPlan = {
      goal: "Circular",
      operations: [
        {
          id: "op_0",
          type: "ANALYZE_REVIEW_SET",
          params: {},
          dependsOn: "op_1",
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
      reasoning: "Circular deps",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("circular_dependency");
  });

  it("should reject operations that don't accept dependencies", () => {
    const plan: OperationPlan = {
      goal: "Bad dependency type",
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
          type: "RETRIEVE_REVIEWS", // Doesn't accept dependencies
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
          dependsOn: "op_0",
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Bad",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("unsupported_combination");
  });

  it("should validate type compatibility between operations", () => {
    const plan: OperationPlan = {
      goal: "Incompatible types",
      operations: [
        {
          id: "op_0",
          type: "GET_PRODUCT_ANALYTICS", // Produces ComparableAnalytics
          params: {
            timeframeDescriptor: {
              type: "NAMED",
              name: "7d",
            },
          },
        },
        {
          id: "op_1",
          type: "ANALYZE_REVIEW_SET", // Only accepts ReviewSet or similar
          params: {},
          dependsOn: "op_0",
        },
      ],
      resultOperationId: "op_1",
      contextReference: false,
      confidence: "high",
      reasoning: "Type mismatch",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("unsupported_combination");
  });

  it("should detect duplicate operation IDs", () => {
    const plan: OperationPlan = {
      goal: "Duplicate IDs",
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
          id: "op_0", // Duplicate!
          type: "ANALYZE_TREND",
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
      reasoning: "Dupe IDs",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("unsupported_feature");
  });

  it("should reject empty operation arrays", () => {
    const plan: OperationPlan = {
      goal: "Empty plan",
      operations: [],
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "high",
      reasoning: "Empty",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
  });

  it("should reject plans exceeding max size", () => {
    const operations = [];
    for (let i = 0; i < 15; i++) {
      operations.push({
        id: `op_${i}`,
        type: "GET_PRODUCT_ANALYTICS",
        params: {
          timeframeDescriptor: {
            type: "NAMED",
            name: "7d",
          },
        },
      });
    }

    const plan: OperationPlan = {
      goal: "Too many operations",
      operations,
      resultOperationId: "op_0",
      contextReference: false,
      confidence: "high",
      reasoning: "Too big",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("invalid");
    expect("failureReason" in result && result.failureReason).toBe("plan_too_complex");
  });

  it("should validate a complex multi-step plan", () => {
    const plan: OperationPlan = {
      goal: "Retrieve reviews and analyze them",
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
        {
          id: "op_2",
          type: "GET_SUPPORTING_EVIDENCE",
          params: {
            claim: "Quality is the main issue",
          },
          dependsOn: "op_1",
        },
      ],
      resultOperationId: "op_2",
      contextReference: false,
      confidence: "high",
      reasoning: "Complex multi-step analysis",
    };

    const result = validatePlan(plan);
    expect(result.validationStatus).toBe("valid");
  });
});
