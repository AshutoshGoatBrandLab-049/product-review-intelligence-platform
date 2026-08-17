import { describe, it, expect } from "vitest";
import { resolveNamedWindow, customWindow, previousEquivalentWindow, daysInWindow } from "../../src/modules/analytics/dateWindows.js";

const ASOF = "2026-08-12";

describe("dateWindows (Phase 3 §1-4)", () => {
  it("7-day window", () => {
    expect(resolveNamedWindow("7d", ASOF)).toEqual({ start: "2026-08-06", end: "2026-08-12" });
  });

  it("30-day window", () => {
    expect(resolveNamedWindow("30d", ASOF)).toEqual({ start: "2026-07-14", end: "2026-08-12" });
  });

  it("60-day window", () => {
    expect(resolveNamedWindow("60d", ASOF)).toEqual({ start: "2026-06-14", end: "2026-08-12" });
  });

  it("90-day window", () => {
    expect(resolveNamedWindow("90d", ASOF)).toEqual({ start: "2026-05-15", end: "2026-08-12" });
  });

  it("6-month window (calendar-month arithmetic)", () => {
    expect(resolveNamedWindow("6m", ASOF)).toEqual({ start: "2026-02-13", end: "2026-08-12" });
  });

  it("12-month window (calendar-month arithmetic)", () => {
    expect(resolveNamedWindow("12m", ASOF)).toEqual({ start: "2025-08-13", end: "2026-08-12" });
  });

  it("custom window: accepts a valid range", () => {
    expect(customWindow("2026-01-01", "2026-01-31")).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });

  it("custom window: rejects an inverted range", () => {
    expect(() => customWindow("2026-02-01", "2026-01-01")).toThrow();
  });

  it("previous equivalent window: matches the documented example exactly", () => {
    const current = { start: "2026-07-14", end: "2026-08-12" };
    expect(previousEquivalentWindow(current)).toEqual({ start: "2026-06-14", end: "2026-07-13" });
  });

  it("previous equivalent window: same length as the current window", () => {
    const current = resolveNamedWindow("90d", ASOF);
    const previous = previousEquivalentWindow(current);
    expect(daysInWindow(previous)).toBe(daysInWindow(current));
  });

  it("daysInWindow is inclusive on both ends", () => {
    expect(daysInWindow({ start: "2026-08-01", end: "2026-08-01" })).toBe(1);
    expect(daysInWindow({ start: "2026-08-01", end: "2026-08-30" })).toBe(30);
  });
});
