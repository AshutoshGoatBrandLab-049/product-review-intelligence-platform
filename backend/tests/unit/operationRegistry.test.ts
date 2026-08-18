/**
 * Unit tests for Operation Registry — PHASE A.
 * Validates that all operations in the registry are properly defined.
 */

import { describe, it, expect } from "vitest";
import {
  OPERATION_REGISTRY,
  getOperationDefinition,
  getSupportedOperationTypes,
  isOperationSupported,
} from "../../src/modules/ai/operationRegistry.js";

describe("Operation Registry", () => {
  it("should have at least one operation defined", () => {
    expect(OPERATION_REGISTRY.size).toBeGreaterThan(0);
  });

  it("should have all required operations", () => {
    const required = [
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

    for (const op of required) {
      expect(OPERATION_REGISTRY.has(op)).toBe(true);
    }
  });

  it("should have consistent operation definitions", () => {
    for (const [type, def] of OPERATION_REGISTRY) {
      // type matches key
      expect(def.type).toBe(type);

      // has description
      expect(def.description).toBeTruthy();
      expect(typeof def.description).toBe("string");

      // has schemas
      expect(def.allowedParams).toBeTruthy();
      expect(def.outputSchema).toBeTruthy();

      // has valid cost estimate
      expect(["low", "medium", "high"]).toContain(def.costEstimate);

      // has evidence behavior
      expect(["carries_through", "deterministic", "none"]).toContain(def.evidenceBehavior);

      // accepted inputs array exists
      expect(Array.isArray(def.acceptedInputTypes)).toBe(true);

      // dependency flag matches accepted inputs
      if (!def.acceptsDependency) {
        expect(def.acceptedInputTypes.length).toBe(0);
      }

      // has examples
      expect(Array.isArray(def.examples)).toBe(true);
      expect(def.examples.length).toBeGreaterThan(0);

      // required/optional params are arrays
      expect(Array.isArray(def.requiredParams)).toBe(true);
      expect(Array.isArray(def.optionalParams)).toBe(true);
    }
  });

  it("should validate operation parameter schemas", () => {
    const def = getOperationDefinition("RETRIEVE_REVIEWS");
    expect(def).toBeTruthy();

    // Valid params should parse
    const validParams = {
      timeframeDescriptor: {
        type: "NAMED" as const,
        name: "7d",
      },
      aspect: "quality",
      sentiment: "negative",
    };

    expect(() => def!.allowedParams.parse(validParams)).not.toThrow();

    // Invalid sentiment should fail
    const invalidParams = {
      timeframeDescriptor: {
        type: "NAMED" as const,
        name: "7d",
      },
      sentiment: "unknown",
    };

    expect(() => def!.allowedParams.parse(invalidParams)).toThrow();
  });

  it("should track accepted input types correctly", () => {
    const retrieveReviews = getOperationDefinition("RETRIEVE_REVIEWS");
    expect(retrieveReviews?.acceptedInputTypes).toEqual([]);
    expect(retrieveReviews?.acceptsDependency).toBe(false);

    const analyzeReviewSet = getOperationDefinition("ANALYZE_REVIEW_SET");
    expect(analyzeReviewSet?.acceptedInputTypes).toContain("RETRIEVE_REVIEWS");
    expect(analyzeReviewSet?.acceptsDependency).toBe(true);
  });

  it("should support operation type queries", () => {
    const types = getSupportedOperationTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);

    for (const type of types) {
      expect(isOperationSupported(type)).toBe(true);
    }

    expect(isOperationSupported("UNKNOWN_OPERATION")).toBe(false);
  });

  it("should validate output schemas", () => {
    const def = getOperationDefinition("RETRIEVE_REVIEWS");
    expect(def).toBeTruthy();

    // Valid output
    const validOutput = {
      reviews: [
        {
          canonicalReviewId: "review1",
          rating: 4,
          reviewText: "Good product",
          reviewDate: "2024-01-01",
          platform: "flipkart",
          sourceProductId: "prod1",
        },
      ],
      count: 1,
      window: { start: "2024-01-01", end: "2024-01-31" },
      aspect: null,
    };

    expect(() => def!.outputSchema.parse(validOutput)).not.toThrow();

    // Invalid output (missing required fields)
    const invalidOutput = {
      reviews: [],
      // missing count, window
    };

    expect(() => def!.outputSchema.parse(invalidOutput)).toThrow();
  });

  it("should not allow operations without types", () => {
    for (const [key, def] of OPERATION_REGISTRY) {
      expect(def.type).toBeTruthy();
      expect(typeof def.type).toBe("string");
    }
  });
});
