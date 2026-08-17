import { describe, it, expect } from "vitest";
import { logger } from "../../src/shared/logger.js";

describe("logger PII guard", () => {
  it("throws (in non-production) if a log object contains reviewText", () => {
    expect(() => logger.info({ reviewText: "some free text" }, "test")).toThrow();
  });

  it("throws if a log object contains author", () => {
    expect(() => logger.info({ author: "Some Name" }, "test")).toThrow();
  });

  it("throws if a log object contains a nested forbidden key", () => {
    expect(() => logger.info({ review: { title: "x" } }, "test")).toThrow();
  });

  it("does not throw for approved fields (canonical id, platform, counts)", () => {
    expect(() =>
      logger.info(
        { canonicalReviewId: "abc123", platform: "flipkart", rowsInserted: 5 },
        "test",
      ),
    ).not.toThrow();
  });
});
