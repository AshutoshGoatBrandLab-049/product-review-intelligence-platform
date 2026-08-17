import { describe, it, expect } from "vitest";
import { comparePeriods } from "../../src/modules/analytics/periodComparison.js";

describe("comparePeriods (Phase 3 §4)", () => {
  it("previous=0, current=0 -> percentageDelta 0, never null/NaN", () => {
    const result = comparePeriods(0, 0);
    expect(result).toEqual({ current: 0, previous: 0, absoluteDelta: 0, percentageDelta: 0 });
  });

  it("previous=0, current>0 -> percentageDelta null (insufficient prior data), never Infinity", () => {
    const result = comparePeriods(50, 0);
    expect(result.percentageDelta).toBeNull();
    expect(Number.isFinite(result.percentageDelta as number)).toBe(false); // it's null, not a finite number either way
    expect(result.absoluteDelta).toBe(50);
  });

  it("normal increase computes a correct percentage", () => {
    const result = comparePeriods(120, 100);
    expect(result).toEqual({ current: 120, previous: 100, absoluteDelta: 20, percentageDelta: 20 });
  });

  it("normal decrease computes a correct negative percentage", () => {
    const result = comparePeriods(80, 100);
    expect(result.percentageDelta).toBe(-20);
  });

  it("never produces NaN or Infinity for any finite input pair", () => {
    const pairs: Array<[number, number]> = [[0, 5], [5, 0], [0, 0], [-1, 5], [1000000, 1]];
    for (const [c, p] of pairs) {
      const result = comparePeriods(c, p);
      if (result.percentageDelta !== null) {
        expect(Number.isFinite(result.percentageDelta)).toBe(true);
      }
    }
  });
});
