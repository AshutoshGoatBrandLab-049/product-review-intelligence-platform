import { describe, it, expect } from "vitest";
import { classifyConfidence, CONFIDENCE_THRESHOLDS } from "../../src/modules/analytics/confidence.js";

describe("classifyConfidence (Phase 3 §14, approved thresholds 100/20/5)", () => {
  it("approved threshold values", () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({
      minReviewsForHighConfidence: 100,
      minReviewsForMediumConfidence: 20,
      minReviewsForLowConfidence: 5,
    });
  });

  it("high confidence at and above 100", () => {
    expect(classifyConfidence(100)).toBe("high");
    expect(classifyConfidence(5000)).toBe("high");
  });

  it("medium confidence between 20 and 99", () => {
    expect(classifyConfidence(20)).toBe("medium");
    expect(classifyConfidence(99)).toBe("medium");
  });

  it("low confidence between 5 and 19", () => {
    expect(classifyConfidence(5)).toBe("low");
    expect(classifyConfidence(19)).toBe("low");
  });

  it("insufficient_data below 5", () => {
    expect(classifyConfidence(4)).toBe("insufficient_data");
    expect(classifyConfidence(0)).toBe("insufficient_data");
  });

  it("thresholds are configurable, not hardcoded into the function", () => {
    const custom = { minReviewsForHighConfidence: 10, minReviewsForMediumConfidence: 5, minReviewsForLowConfidence: 2 };
    expect(classifyConfidence(10, custom)).toBe("high");
    expect(classifyConfidence(1, custom)).toBe("insufficient_data");
  });
});
