import { describe, it, expect } from "vitest";
import { validateAiOutput, dedupeThemes, isFreshEnoughToWrite } from "../../src/modules/ai/validation.js";

describe("validateAiOutput (Phase 4 §6/§14/§15)", () => {
  it("item 2: accepts valid sentiment + theme output", () => {
    const result = validateAiOutput({
      sentiment: { label: "positive", confidence: 0.9 },
      themes: [{ theme: "quality", confidence: 0.8, evidence: "great quality" }],
    });
    expect(result.valid).toBe(true);
  });

  it("item 3: rejects an invalid sentiment label", () => {
    const result = validateAiOutput({ sentiment: { label: "very_happy", confidence: 0.9 }, themes: [] });
    expect(result.valid).toBe(false);
  });

  it("item 4: rejects confidence outside 0-1 (both directions)", () => {
    expect(validateAiOutput({ sentiment: { label: "positive", confidence: 1.5 }, themes: [] }).valid).toBe(false);
    expect(validateAiOutput({ sentiment: { label: "positive", confidence: -0.1 }, themes: [] }).valid).toBe(false);
  });

  it("item 13: enforces the controlled theme vocabulary — unknown theme rejected", () => {
    const result = validateAiOutput({
      sentiment: { label: "negative", confidence: 0.8 },
      themes: [{ theme: "smells_bad", confidence: 0.7, evidence: "e" }],
    });
    expect(result.valid).toBe(false);
  });

  it("item 16: rejects malformed AI output outright — never silently coerced", () => {
    expect(validateAiOutput({ nonsense: true }).valid).toBe(false);
    expect(validateAiOutput(null).valid).toBe(false);
    expect(validateAiOutput("free-form prose response").valid).toBe(false);
  });

  it("item 14: duplicate theme prevention — dedupeThemes keeps the higher-confidence observation", () => {
    const deduped = dedupeThemes([
      { theme: "quality", confidence: 0.5, evidence: "a" },
      { theme: "quality", confidence: 0.9, evidence: "b" },
      { theme: "delivery", confidence: 0.7, evidence: "c" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((t) => t.theme === "quality")?.confidence).toBe(0.9);
  });

  it("validateAiOutput itself dedupes before returning valid data", () => {
    const result = validateAiOutput({
      sentiment: { label: "negative", confidence: 0.8 },
      themes: [
        { theme: "fit", confidence: 0.6, evidence: "a" },
        { theme: "fit", confidence: 0.4, evidence: "b" },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.themes).toHaveLength(1);
    }
  });

  it("item 7 (freshness guard unit): isFreshEnoughToWrite refuses a stale hash write", () => {
    expect(isFreshEnoughToWrite({ currentContentHash: "abc", hashBeingWritten: "abc" })).toBe(true);
    expect(isFreshEnoughToWrite({ currentContentHash: "abc", hashBeingWritten: "def" })).toBe(false);
  });
});
