import { describe, it, expect } from "vitest";
import {
  detectIntent,
  resolveIntentWithContext,
  isRetrievalIntent,
  AnalyticalIntent,
  type PriorTurnContext,
} from "../../src/modules/ai/intentDetection.js";

describe("detectIntent — English", () => {
  it("classifies explicit retrieval phrasing as REVIEW_EXPLORATION", () => {
    expect(detectIntent("show me all the bad reviews")).toBe(AnalyticalIntent.REVIEW_EXPLORATION);
    expect(detectIntent("Show me negative reviews")).toBe(AnalyticalIntent.REVIEW_EXPLORATION);
    expect(detectIntent("give me the best reviews")).toBe(AnalyticalIntent.REVIEW_EXPLORATION);
  });

  it("classifies top-problem phrasing as TOP_PROBLEM, not COMPLAINT_ANALYSIS", () => {
    expect(detectIntent("What's the biggest issue?")).toBe(AnalyticalIntent.TOP_PROBLEM);
    expect(detectIntent("what is the main problem")).toBe(AnalyticalIntent.TOP_PROBLEM);
  });

  it("REVIEW_EXPLORATION takes priority over COMPLAINT_ANALYSIS keywords", () => {
    // "bad" alone would match COMPLAINT_ANALYSIS, but "show me" must win.
    expect(detectIntent("show me all the bad reviews")).toBe(AnalyticalIntent.REVIEW_EXPLORATION);
  });
});

describe("detectIntent — Hinglish / Roman Hindi / typos", () => {
  it("resolves 'bad reviews dikhao' to REVIEW_EXPLORATION", () => {
    expect(detectIntent("bad reviews dikhao")).toBe(AnalyticalIntent.REVIEW_EXPLORATION);
    expect(detectIntent("kharaab reviews dikhao")).toBe(AnalyticalIntent.REVIEW_EXPLORATION);
  });

  it("resolves 'product me kya dikkat h' to TOP_PROBLEM", () => {
    expect(detectIntent("product me kya dikkat h")).toBe(AnalyticalIntent.TOP_PROBLEM);
  });

  it("resolves 'bhai sabse badi problem kya h' to TOP_PROBLEM", () => {
    expect(detectIntent("bhai sabse badi problem kya h")).toBe(AnalyticalIntent.TOP_PROBLEM);
  });

  it("resolves 'quality ka kya scene hai' to TOP_PROBLEM", () => {
    expect(detectIntent("quality ka kya scene hai")).toBe(AnalyticalIntent.TOP_PROBLEM);
  });

  it("resolves 'customers kis baat se pareshan hain' to COMPLAINT_ANALYSIS", () => {
    expect(detectIntent("customers kis baat se pareshan hain")).toBe(AnalyticalIntent.COMPLAINT_ANALYSIS);
  });
});

describe("isRetrievalIntent", () => {
  it("classifies REVIEW_EXPLORATION and EVIDENCE_RETRIEVAL as retrieval", () => {
    expect(isRetrievalIntent(AnalyticalIntent.REVIEW_EXPLORATION)).toBe(true);
    expect(isRetrievalIntent(AnalyticalIntent.EVIDENCE_RETRIEVAL)).toBe(true);
  });

  it("classifies TOP_PROBLEM and STATS_QUERY as non-retrieval", () => {
    expect(isRetrievalIntent(AnalyticalIntent.TOP_PROBLEM)).toBe(false);
    expect(isRetrievalIntent(AnalyticalIntent.STATS_QUERY)).toBe(false);
  });
});

describe("resolveIntentWithContext", () => {
  it("classifies a full, unambiguous question without needing context", () => {
    const resolved = resolveIntentWithContext("What's the biggest issue?");
    expect(resolved.kind).toBe("ANALYSIS");
    expect(resolved.resolvedFromContext).toBe(false);
  });

  it("resolves a full retrieval question directly to RETRIEVAL", () => {
    const resolved = resolveIntentWithContext("show me all the bad reviews");
    expect(resolved.kind).toBe("RETRIEVAL");
    expect(resolved.resolvedFromContext).toBe(false);
  });

  it("returns NEEDS_CLARIFICATION for a bare 'show me' with no prior context", () => {
    const resolved = resolveIntentWithContext("show me");
    expect(resolved.kind).toBe("NEEDS_CLARIFICATION");
    expect(resolved.clarificationPrompt).toBeTruthy();
  });

  it("resolves a bare 'show me' to RETRIEVAL when prior context exists", () => {
    const priorContext: PriorTurnContext = {
      intent: AnalyticalIntent.TOP_PROBLEM,
      aspect: "zip broke",
      reviewIds: ["r1", "r2"],
    };
    const resolved = resolveIntentWithContext("show me", priorContext);
    expect(resolved.kind).toBe("RETRIEVAL");
    expect(resolved.resolvedFromContext).toBe(true);
    expect(resolved.context?.aspect).toBe("zip broke");
  });

  it("resolves 'show those' to RETRIEVAL given prior context", () => {
    const priorContext: PriorTurnContext = {
      intent: AnalyticalIntent.REVIEW_EXPLORATION,
      reviewIds: ["r1", "r2", "r3"],
    };
    const resolved = resolveIntentWithContext("show those", priorContext);
    expect(resolved.kind).toBe("RETRIEVAL");
    expect(resolved.resolvedFromContext).toBe(true);
  });

  it("resolves a bare 'why?' to EXPLAIN_PREVIOUS given prior analysis context", () => {
    const priorContext: PriorTurnContext = {
      intent: AnalyticalIntent.TOP_PROBLEM,
      aspect: "battery drains fast",
      reviewIds: ["r1"],
    };
    const resolved = resolveIntentWithContext("why?", priorContext);
    expect(resolved.kind).toBe("EXPLAIN_PREVIOUS");
    expect(resolved.context?.aspect).toBe("battery drains fast");
  });

  it("returns NEEDS_CLARIFICATION for a bare 'why?' with no prior context", () => {
    const resolved = resolveIntentWithContext("why?");
    expect(resolved.kind).toBe("NEEDS_CLARIFICATION");
  });

  it("resolves 'latest 3' as RETRIEVAL given any prior context", () => {
    const priorContext: PriorTurnContext = {
      intent: AnalyticalIntent.STATS_QUERY,
    };
    const resolved = resolveIntentWithContext("latest 3", priorContext);
    expect(resolved.kind).toBe("RETRIEVAL");
  });
});
