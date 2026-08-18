import { describe, expect, it } from "vitest";
import {
  resolveQuerySemantic,
  ResolvedQueryLlmOutputSchema,
  type QueryResolutionInput,
} from "../../src/modules/ai/queryUnderstanding.js";
import { resolveTimeframeDescriptor, type TimeframeDescriptor } from "../../src/modules/ai/timeframeResolution.js";
import { AnalyticalIntent } from "../../src/modules/ai/intentDetection.js";
import type { AiProvider } from "../../src/modules/ai/providers/aiProvider.js";

/**
 * Phase 10 semantic-query-understanding — DETERMINISTIC-PIPELINE tests.
 *
 * These tests do NOT prove semantic generalization to novel paraphrases —
 * that can only be demonstrated against a real LLM (see
 * tests/real-provider/semanticQueryUnderstanding.real.test.ts). What is
 * proven here, with fixed/fabricated provider responses:
 *   1. resolveTimeframeDescriptor() — the deterministic conversion of a
 *      semantic timeframe descriptor into a real DateWindow — is correct for
 *      every descriptor type.
 *   2. resolvedViaFallback triggers correctly on provider failure, missing
 *      implementation, and schema-invalid output, and does NOT trigger on a
 *      valid successful call.
 *   3. The backend, not the model, is the authority on whether a contextual
 *      ("it"/"that"/pronoun) reference is resolvable — a model claiming
 *      contextReference with no real prior turn degrades to CLARIFY.
 */

const PRODUCT_CONTEXT = { platform: "flipkart" as const, sourceProductId: "TEST-PRODUCT" };

function fixedProvider(output: unknown, opts?: { throws?: boolean }): AiProvider {
  return {
    name: "fixed-mock",
    modelVersion: "fixed-mock-v1",
    async analyzeReview() {
      return {};
    },
    async narrate() {
      return {};
    },
    async resolveQuery() {
      if (opts?.throws) throw new Error("simulated provider failure");
      return output;
    },
  };
}

function providerWithoutResolveQuery(): AiProvider {
  return {
    name: "no-resolve-query",
    modelVersion: "v1",
    async analyzeReview() {
      return {};
    },
    async narrate() {
      return {};
    },
    // resolveQuery deliberately omitted — exercises the "not implemented" fallback path.
  };
}

describe("resolveTimeframeDescriptor — deterministic semantic-descriptor -> DateWindow conversion", () => {
  const asOf = "2026-08-17";

  it("NONE -> null (no timeframe constraint forced)", () => {
    expect(resolveTimeframeDescriptor({ type: "NONE" }, asOf)).toBeNull();
  });

  it("RELATIVE {value:5, unit:day} -> 5-day window ending on asOf", () => {
    const result = resolveTimeframeDescriptor({ type: "RELATIVE", value: 5, unit: "day" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-13", end: "2026-08-17" });
  });

  it("RELATIVE {value:2, unit:week} -> 14-day window ending on asOf", () => {
    const result = resolveTimeframeDescriptor({ type: "RELATIVE", value: 2, unit: "week" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-04", end: "2026-08-17" });
  });

  it("RELATIVE with missing value -> null (never guesses)", () => {
    expect(resolveTimeframeDescriptor({ type: "RELATIVE", unit: "day" }, asOf)).toBeNull();
  });

  it("ABSOLUTE with valid start/end -> that exact window", () => {
    const result = resolveTimeframeDescriptor({ type: "ABSOLUTE", start: "2026-08-01", end: "2026-08-10" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-01", end: "2026-08-10" });
  });

  it("ABSOLUTE with reversed start/end -> normalized (never throws)", () => {
    const result = resolveTimeframeDescriptor({ type: "ABSOLUTE", start: "2026-08-10", end: "2026-08-01" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-01", end: "2026-08-10" });
  });

  it("ABSOLUTE with missing dates -> unparseable:true, never a guessed range", () => {
    const result = resolveTimeframeDescriptor({ type: "ABSOLUTE" }, asOf);
    expect(result?.unparseable).toBe(true);
  });

  it("NAMED 'yesterday' -> the single day before asOf", () => {
    const result = resolveTimeframeDescriptor({ type: "NAMED", name: "yesterday" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-16", end: "2026-08-16" });
  });

  it("NAMED 'today' -> asOf itself", () => {
    const result = resolveTimeframeDescriptor({ type: "NAMED", name: "today" }, asOf);
    expect(result?.window).toEqual({ start: asOf, end: asOf });
  });

  it("NAMED 'last_week' -> 7-day window ending on asOf", () => {
    const result = resolveTimeframeDescriptor({ type: "NAMED", name: "last_week" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-11", end: "2026-08-17" });
  });

  it("NAMED 'this_month' -> month-to-date", () => {
    const result = resolveTimeframeDescriptor({ type: "NAMED", name: "this_month" }, asOf);
    expect(result?.window).toEqual({ start: "2026-08-01", end: asOf });
  });

  it("NAMED 'last_month' -> the full previous calendar month", () => {
    const result = resolveTimeframeDescriptor({ type: "NAMED", name: "last_month" }, asOf);
    expect(result?.window).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  });

  it("NAMED with an unrecognized name -> null (degrades, never guesses)", () => {
    expect(resolveTimeframeDescriptor({ type: "NAMED", name: "someday" }, asOf)).toBeNull();
  });
});

describe("ResolvedQueryLlmOutputSchema — closed action enum, never accepts an invented action", () => {
  it("accepts a well-formed resolution", () => {
    const parsed = ResolvedQueryLlmOutputSchema.safeParse({
      action: "RETRIEVE_REVIEWS",
      timeframeDescriptor: { type: "NONE" },
      sentiment: "negative",
      quantity: 10,
      aspect: null,
      contextReference: false,
      responseStyle: "DEFAULT",
      reasoning: "user asked to see negative reviews",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an action outside the closed enum", () => {
    const parsed = ResolvedQueryLlmOutputSchema.safeParse({
      action: "DELETE_ALL_REVIEWS",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null,
      contextReference: false,
      responseStyle: "DEFAULT",
      reasoning: "invented action",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const parsed = ResolvedQueryLlmOutputSchema.safeParse({
      action: "RETRIEVE_REVIEWS",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null,
      contextReference: false,
      // responseStyle missing
      reasoning: "x",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("resolveQuerySemantic — resolvedViaFallback correctness", () => {
  it("does NOT set resolvedViaFallback on a valid successful LLM call", async () => {
    const provider = fixedProvider({
      action: "RETRIEVE_REVIEWS",
      timeframeDescriptor: { type: "RELATIVE", value: 5, unit: "day" },
      sentiment: "negative",
      quantity: 10,
      aspect: null,
      contextReference: false,
      responseStyle: "DEFAULT",
      reasoning: "test fixture",
    });

    const result = await resolveQuerySemantic("show me the negative reviews from the last 5 days", provider, undefined, PRODUCT_CONTEXT);

    expect(result.resolvedViaFallback).toBeFalsy();
    expect(result.action).toBe("RETRIEVE_REVIEWS");
    expect(result.sentiment).toBe("negative");
    expect(result.quantity).toBe(10);
    expect(result.timeframe?.value).toBe(5);
  });

  it("sets resolvedViaFallback:true when the provider throws", async () => {
    const provider = fixedProvider(null, { throws: true });
    const result = await resolveQuerySemantic("what's the biggest issue", provider, undefined, PRODUCT_CONTEXT);
    expect(result.resolvedViaFallback).toBe(true);
    // The deterministic fallback resolver still produces a correct answer for this question.
    expect(result.action).toBe("ANALYZE_PROBLEM");
  });

  it("sets resolvedViaFallback:true when the provider has no resolveQuery implementation", async () => {
    const provider = providerWithoutResolveQuery();
    const result = await resolveQuerySemantic("show me the reviews", provider, undefined, PRODUCT_CONTEXT);
    expect(result.resolvedViaFallback).toBe(true);
    expect(result.action).toBe("RETRIEVE_REVIEWS");
  });

  it("sets resolvedViaFallback:true when the provider's output fails schema validation", async () => {
    const provider = fixedProvider({
      action: "NOT_A_REAL_ACTION",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null,
      contextReference: false,
      responseStyle: "DEFAULT",
      reasoning: "malformed",
    });
    const result = await resolveQuerySemantic("show me the reviews", provider, undefined, PRODUCT_CONTEXT);
    expect(result.resolvedViaFallback).toBe(true);
  });

  it("backend overrides a claimed contextReference to CLARIFY when there is no real prior turn", async () => {
    const provider = fixedProvider({
      action: "RETRIEVE_REVIEWS",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null,
      contextReference: true, // model believes this is a pronoun follow-up
      responseStyle: "DEFAULT",
      reasoning: "model incorrectly believes there is context",
    });
    // No priorContext supplied — the backend, not the model, is authoritative here.
    const result = await resolveQuerySemantic("show me those", provider, undefined, PRODUCT_CONTEXT);
    expect(result.action).toBe("CLARIFY");
    expect(result.kind).toBe("NEEDS_CLARIFICATION");
    expect(result.resolvedViaFallback).toBeFalsy();
  });

  it("real contextReference WITH a real prior turn inherits the prior aspect (pronoun resolution)", async () => {
    const provider = fixedProvider({
      action: "RETRIEVE_REVIEWS",
      timeframeDescriptor: { type: "NONE" },
      sentiment: null,
      quantity: null,
      aspect: null, // model didn't restate the aspect explicitly
      contextReference: true,
      responseStyle: "DEFAULT",
      reasoning: "pronoun follow-up",
    });
    const priorContext = { intent: AnalyticalIntent.TOP_PROBLEM, aspect: "battery_life", reviewIds: ["r1", "r2"] };
    const result = await resolveQuerySemantic("show me those", provider, priorContext, PRODUCT_CONTEXT);
    expect(result.action).toBe("RETRIEVE_REVIEWS");
    expect(result.aspect).toBe("battery_life");
    expect(result.resolvedFromContext).toBe(true);
  });
});

describe("QueryResolutionInput shape — conversation context passed to the provider", () => {
  it("carries lastAspect/lastReviewIds through to the provider call", async () => {
    let capturedInput: QueryResolutionInput | undefined;
    const provider: AiProvider = {
      name: "capture",
      modelVersion: "v1",
      async analyzeReview() {
        return {};
      },
      async narrate() {
        return {};
      },
      async resolveQuery(input) {
        capturedInput = input;
        return {
          action: "RETRIEVE_REVIEWS",
          timeframeDescriptor: { type: "NONE" },
          sentiment: null,
          quantity: null,
          aspect: "battery_life",
          contextReference: true,
          responseStyle: "DEFAULT",
          reasoning: "x",
        };
      },
    };
    const priorContext = { intent: AnalyticalIntent.TOP_PROBLEM, aspect: "battery_life", reviewIds: ["r1"] };
    await resolveQuerySemantic("show me those", provider, priorContext, PRODUCT_CONTEXT);

    expect(capturedInput?.conversationContext.lastAspect).toBe("battery_life");
    expect(capturedInput?.conversationContext.lastReviewIds).toEqual(["r1"]);
    expect(capturedInput?.productContext).toEqual(PRODUCT_CONTEXT);
  });
});
