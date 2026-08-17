import { describe, it, expect } from "vitest";
import { computeCanonicalReviewId } from "../../src/modules/ingestion/shared/canonicalId.js";

describe("computeCanonicalReviewId", () => {
  it("is deterministic — same input always yields the same output", () => {
    const a = computeCanonicalReviewId("flipkart", "PID001", "fk_hash_0001");
    const b = computeCanonicalReviewId("flipkart", "PID001", "fk_hash_0001");
    expect(a).toBe(b);
  });

  it("produces a 32-character lowercase hex string", () => {
    const id = computeCanonicalReviewId("myntra", "5001", "myn_r_0001");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("differs when platform differs, all else equal", () => {
    const a = computeCanonicalReviewId("flipkart", "PID001", "R1");
    const b = computeCanonicalReviewId("myntra", "PID001", "R1");
    expect(a).not.toBe(b);
  });

  it("differs when sourceProductId differs", () => {
    const a = computeCanonicalReviewId("flipkart", "PID001", "R1");
    const b = computeCanonicalReviewId("flipkart", "PID002", "R1");
    expect(a).not.toBe(b);
  });

  it("differs when sourceReviewId differs", () => {
    const a = computeCanonicalReviewId("flipkart", "PID001", "R1");
    const b = computeCanonicalReviewId("flipkart", "PID001", "R2");
    expect(a).not.toBe(b);
  });

  it("does not collide across a colon-ambiguous input pair (platform:product vs product:review boundary)", () => {
    // ("flipkart", "P:1", "R") vs ("flipkart", "P", "1:R") would hash to the
    // same joined string if the separator weren't applied consistently —
    // confirms the join is well-defined for this input shape.
    const a = computeCanonicalReviewId("flipkart", "P:1", "R");
    const b = computeCanonicalReviewId("flipkart", "P", "1:R");
    expect(a).not.toBe(b);
  });
});
