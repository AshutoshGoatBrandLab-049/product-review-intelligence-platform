import { describe, expect, it } from "vitest";
import { resolveQuery } from "../../src/modules/ai/queryResolution.js";
import { AnalyticalIntent } from "../../src/modules/ai/intentDetection.js";

/**
 * Phase 10 query-understanding correction — regression table mandated by the
 * spec. Every row here was either a confirmed real-conversation failure
 * (see the phase report) or an explicit required-behavior row from the spec.
 */
describe("queryResolution — resolveQuery action resolution table", () => {
  it("'latest reviews' -> RETRIEVE_REVIEWS", () => {
    expect(resolveQuery("show me the latest reviews").action).toBe("RETRIEVE_REVIEWS");
  });

  it("'latest 20 reviews' -> RETRIEVE_REVIEWS with quantity=20", () => {
    const rq = resolveQuery("show me the latest 20 reviews");
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.quantity).toBe(20);
  });

  it("'last 5 days reviews' -> RETRIEVE_REVIEWS with a resolved timeframe", () => {
    const rq = resolveQuery("last 5 days reviews");
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.timeframe).not.toBeNull();
    expect(rq.timeframe?.value).toBe(5);
  });

  it("'negative reviews' -> RETRIEVE_REVIEWS with sentiment=negative", () => {
    const rq = resolveQuery("show me the negative reviews");
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.sentiment).toBe("negative");
  });

  it("'last 5 days negative reviews' -> RETRIEVE_REVIEWS + timeframe + sentiment together (compositional)", () => {
    const rq = resolveQuery("last 5 days ke negative reviews dikhao");
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.timeframe?.value).toBe(5);
    expect(rq.sentiment).toBe("negative");
  });

  it("'biggest issue' -> ANALYZE_PROBLEM", () => {
    expect(resolveQuery("what's the biggest issue").action).toBe("ANALYZE_PROBLEM");
    expect(resolveQuery("what's the biggest issue").intent).toBe(AnalyticalIntent.TOP_PROBLEM);
  });

  it("'customer complaints' -> ANALYZE_COMPLAINTS", () => {
    expect(resolveQuery("what are customers complaining about").action).toBe("ANALYZE_COMPLAINTS");
  });

  it("'how can improve this product' (ungrammatical real variant) -> RECOMMEND_IMPROVEMENTS", () => {
    const rq = resolveQuery("how can improve this product");
    expect(rq.action).toBe("RECOMMEND_IMPROVEMENTS");
    expect(rq.intent).toBe(AnalyticalIntent.RECOMMENDATION);
  });

  it("'how can we improve' (grammatical form) -> RECOMMEND_IMPROVEMENTS", () => {
    expect(resolveQuery("how can we improve").action).toBe("RECOMMEND_IMPROVEMENTS");
  });

  it("'what should we fix first' -> RECOMMEND_IMPROVEMENTS", () => {
    expect(resolveQuery("what should we fix first").action).toBe("RECOMMEND_IMPROVEMENTS");
  });

  it("'why?' after a prior analysis turn -> EXPLAIN_PREVIOUS_RESULT", () => {
    const rq = resolveQuery("why?", { intent: AnalyticalIntent.TOP_PROBLEM, aspect: "Fit" });
    expect(rq.action).toBe("EXPLAIN_PREVIOUS_RESULT");
    expect(rq.kind).toBe("EXPLAIN_PREVIOUS");
  });

  it("'show me' after a prior ANALYSIS turn -> RETRIEVE_REVIEWS, filtered to that turn's aspect", () => {
    const rq = resolveQuery("show me", { intent: AnalyticalIntent.TOP_PROBLEM, aspect: "Fit" });
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.aspect).toBe("Fit");
    expect(rq.filters.theme).toBe("Fit");
  });

  it("'show me' after a prior RETRIEVAL turn -> repeats retrieval", () => {
    const rq = resolveQuery("show me", { intent: AnalyticalIntent.REVIEW_EXPLORATION, reviewIds: ["a", "b"] });
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
  });

  it("'show those' -> RETRIEVE_REVIEWS filtered to the prior aspect", () => {
    const rq = resolveQuery("show those", { intent: AnalyticalIntent.COMPLAINT_ANALYSIS, aspect: "battery life" });
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.aspect).toBe("battery life");
  });

  it("ambiguous follow-up with no prior context -> CLARIFY", () => {
    const rq = resolveQuery("show me");
    expect(rq.action).toBe("CLARIFY");
    expect(rq.kind).toBe("NEEDS_CLARIFICATION");
  });

  // --- Confirmed real-conversation failures (see phase report) -----------

  it("REGRESSION: 'mujhe last 5 days ka reviews dekhna h' no longer falls through to STATS_QUERY", () => {
    const rq = resolveQuery("mujhe last 5 days ka reviews dekhna h");
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
    expect(rq.timeframe?.value).toBe(5);
  });

  it("REGRESSION: 'how can improve this product' no longer falls through to STATS_QUERY", () => {
    expect(resolveQuery("how can improve this product").action).not.toBe("SHOW_STATISTICS");
  });

  // --- Priority ordering preserved from the prior round -------------------

  it("retrieval verb takes priority over analytical keyword 'bad' in the same message", () => {
    const rq = resolveQuery("show me the bad reviews");
    expect(rq.action).toBe("RETRIEVE_REVIEWS");
  });

  it("Hinglish retrieval verbs from spec §5 all resolve to RETRIEVE_REVIEWS", () => {
    for (const q of [
      "reviews dekhna hai",
      "reviews batao",
      "reviews nikalo",
      "reviews de do",
    ]) {
      expect(resolveQuery(q).action, q).toBe("RETRIEVE_REVIEWS");
    }
  });
});
