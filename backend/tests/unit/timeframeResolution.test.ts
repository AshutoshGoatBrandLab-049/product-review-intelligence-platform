import { describe, expect, it } from "vitest";
import { resolveTimeframeFromQuestion } from "../../src/modules/ai/timeframeResolution.js";

const ASOF = "2026-08-17";

describe("timeframeResolution — resolveTimeframeFromQuestion", () => {
  it("parses arbitrary N in 'last N days' (not just the fixed 7/30/60/90 set)", () => {
    const tf = resolveTimeframeFromQuestion("mujhe last 5 days ka reviews dekhna h", ASOF);
    expect(tf).not.toBeNull();
    expect(tf?.type).toBe("RELATIVE");
    expect(tf?.unit).toBe("day");
    expect(tf?.value).toBe(5);
    // Convention: N calendar days ending on asOf, inclusive both ends —
    // same rule as resolveNamedWindow("7d"). 5 days back from 2026-08-17 = 2026-08-13.
    expect(tf?.window).toEqual({ start: "2026-08-13", end: "2026-08-17" });
  });

  it("parses Hinglish 'pichhle N din'", () => {
    const tf = resolveTimeframeFromQuestion("mujhe pichhle 5 din ke reviews dikhao", ASOF);
    expect(tf?.unit).toBe("day");
    expect(tf?.value).toBe(5);
    expect(tf?.window).toEqual({ start: "2026-08-13", end: "2026-08-17" });
  });

  it("parses 'N din ke' form without 'last/pichhle'", () => {
    const tf = resolveTimeframeFromQuestion("5 din ke reviews", ASOF);
    expect(tf?.unit).toBe("day");
    expect(tf?.value).toBe(5);
  });

  it("parses 'kal ke' (yesterday) as a single-day window", () => {
    const tf = resolveTimeframeFromQuestion("kal ke reviews dikhao", ASOF);
    expect(tf?.window).toEqual({ start: "2026-08-16", end: "2026-08-16" });
  });

  it("parses 'aaj ke' (today) as a single-day window", () => {
    const tf = resolveTimeframeFromQuestion("aaj ke reviews dikhao", ASOF);
    expect(tf?.window).toEqual({ start: "2026-08-17", end: "2026-08-17" });
  });

  it("parses English 'yesterday' and 'today'", () => {
    expect(resolveTimeframeFromQuestion("show me yesterday's reviews", ASOF)?.window).toEqual({
      start: "2026-08-16",
      end: "2026-08-16",
    });
    expect(resolveTimeframeFromQuestion("show me today's reviews", ASOF)?.window).toEqual({
      start: "2026-08-17",
      end: "2026-08-17",
    });
  });

  it("does NOT force a timeframe for bare 'recent'/'latest' with no concrete unit", () => {
    expect(resolveTimeframeFromQuestion("show me the latest reviews", ASOF)).toBeNull();
    expect(resolveTimeframeFromQuestion("show me recent reviews", ASOF)).toBeNull();
  });

  it("parses 'last week'", () => {
    const tf = resolveTimeframeFromQuestion("what happened last week", ASOF);
    expect(tf?.window).toEqual({ start: "2026-08-11", end: "2026-08-17" });
  });

  it("parses 'this month' and 'last month'", () => {
    expect(resolveTimeframeFromQuestion("reviews this month", ASOF)?.window).toEqual({
      start: "2026-08-01",
      end: "2026-08-17",
    });
    expect(resolveTimeframeFromQuestion("reviews last month", ASOF)?.window).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("best-effort parses an absolute range 'from Aug 1 to Aug 10'", () => {
    const tf = resolveTimeframeFromQuestion("show reviews from Aug 1 to Aug 10", ASOF);
    expect(tf?.type).toBe("ABSOLUTE");
    expect(tf?.unparseable).toBeFalsy();
    expect(tf?.window).toEqual({ start: "2026-08-01", end: "2026-08-10" });
  });

  it("flags a genuinely unparseable absolute range instead of silently ignoring it", () => {
    const tf = resolveTimeframeFromQuestion("show reviews from blah to blah", ASOF);
    expect(tf?.type).toBe("ABSOLUTE");
    expect(tf?.unparseable).toBe(true);
  });

  it("returns null when no timeframe expression is present at all", () => {
    expect(resolveTimeframeFromQuestion("what's the biggest issue", ASOF)).toBeNull();
  });
});
