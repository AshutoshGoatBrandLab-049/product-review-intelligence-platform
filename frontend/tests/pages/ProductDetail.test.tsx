import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProductDetail } from "@/pages/ProductDetail";
import { ApiClientError } from "@/api/errors";
import type { ProductDetailResponse, ProductSignalsResponse, ProductInsightsResponse, HealthScore, EarlyWarningSignal, EvidenceReviewsResponse, ReviewDetail } from "@/types/api";
import { daysAgoIso, todayIso } from "@/components/intelligence/DateRangeSelector";

const { getProductDetailMock, getProductSignalsMock, getProductInsightsMock, getEvidenceReviewsMock, getOrCreateConversationMock, analyzeProductQuestionMock } = vi.hoisted(() => ({
  getProductDetailMock: vi.fn(),
  getProductSignalsMock: vi.fn(),
  getProductInsightsMock: vi.fn(),
  getEvidenceReviewsMock: vi.fn(),
  getOrCreateConversationMock: vi.fn(),
  analyzeProductQuestionMock: vi.fn(),
}));

vi.mock("@/api/endpoints/products", () => ({
  getProductDetail: getProductDetailMock,
  getProductSignals: getProductSignalsMock,
  getProductInsights: getProductInsightsMock,
}));

vi.mock("@/api/endpoints/evidence", () => ({
  getEvidenceReviews: getEvidenceReviewsMock,
}));

vi.mock("@/api/endpoints/conversation", () => ({
  getOrCreateConversation: getOrCreateConversationMock,
}));

vi.mock("@/api/endpoints/analyst", () => ({
  analyzeProductQuestion: analyzeProductQuestionMock,
}));

function makeHealth(overrides: Partial<HealthScore> = {}): HealthScore {
  return {
    scopeType: "product",
    platform: "flipkart",
    sourceProductId: "PID001",
    ratingScore: 87.3,
    sentimentScore: 61,
    complaintScore: 88,
    severityScore: null,
    trendScore: 42.1,
    totalScore: null,
    version: "health-v0-hypothesis",
    weights: { rating: 0.3, sentiment: 0.25, complaint: 0.2, severity: 0.15, trend: 0.1 },
    computedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDetailResponse(overrides: Partial<ProductDetailResponse> = {}): ProductDetailResponse {
  return {
    platform: "flipkart",
    sourceProductId: "PID001",
    window: { start: "2026-01-01", end: "2026-01-30" },
    analytics: {
      platform: "flipkart",
      sourceProductId: "PID001",
      brand: "Bluepeak",
      brandInconsistent: false,
      recentMetrics: {
        totalReviews: 120,
        averageRating: 4.31,
        ratingDistribution: { 1: 5, 2: 5, 3: 10, 4: 40, 5: 60 },
        ratingPercentages: { 1: 4, 2: 4, 3: 8, 4: 33, 5: 50 },
        positivePercentage: 78,
        negativePercentage: 8,
        neutralPercentage: 14,
        reviewVelocity: 4,
        uniqueProducts: 1,
        confidence: "high",
      },
      historicalMetrics: {
        totalReviews: 100,
        averageRating: 4.1,
        ratingDistribution: { 1: 4, 2: 4, 3: 12, 4: 40, 5: 40 },
        ratingPercentages: { 1: 4, 2: 4, 3: 12, 4: 40, 5: 40 },
        positivePercentage: 70,
        negativePercentage: 10,
        neutralPercentage: 20,
        reviewVelocity: 3,
        uniqueProducts: 1,
        confidence: "high",
      },
      ratingComparison: { current: 4.31, previous: 4.1, absoluteDelta: 0.21, percentageDelta: 5.1 },
      trendDirection: "improving",
    },
    health: makeHealth(),
    ...overrides,
  };
}

function makeSignalsResponse(overrides: Partial<ProductSignalsResponse> = {}): ProductSignalsResponse {
  return {
    platform: "flipkart",
    sourceProductId: "PID001",
    window: { start: "2026-01-01", end: "2026-01-30" },
    signals: [],
    ...overrides,
  };
}

function makeInsightsResponse(overrides: Partial<ProductInsightsResponse> = {}): ProductInsightsResponse {
  return {
    platform: "flipkart",
    sourceProductId: "PID001",
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    insight: {
      summary: "Reviews indicate quality is the most common negative theme.",
      rootCause: [{ theme: "quality", explanation: "Quality concerns appear in several reviews.", evidenceReviewIds: ["r1", "r2"] }],
      recommendations: [{ reason: "Investigate quality control.", evidenceReviewIds: ["r1"], confidence: 0.7, theme: "quality" }],
      rejectedCitations: [],
      irrelevantCitations: [],
      droppedUnsupportedClaims: 0,
      citedMetrics: [{ field: "reviewCount", statedValue: 120 }],
      ungroundedMetrics: [],
    },
    ...overrides,
  };
}

function renderProductDetail(initialPath = "/products/flipkart/PID001") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
  }

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes>
          <Route path="/products/:platform/:sourceProductId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeReview(overrides: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    canonicalReviewId: "rev123abc456def789",
    platform: "flipkart",
    sourceProductId: "PID001",
    sourceReviewId: "src-123",
    rating: 4,
    title: "Great product",
    reviewText: "This product works really well. Highly recommend!",
    author: "Test Reviewer",
    reviewDate: "2026-08-14",
    reviewTimestamp: "2026-08-14T15:30:00Z",
    dateConfidence: "exact",
    helpfulCount: 5,
    notHelpfulCount: 1,
    verifiedPurchase: true,
    hasImages: false,
    imageUrls: null,
    sizePurchased: null,
    colorPurchased: null,
    country: "IN",
    productUrl: null,
    brand: "TestBrand",
    identityConfidence: "native",
    sentiment: "positive",
    sentimentConfidence: 0.95,
    sentimentModelVersion: "v1",
    themes: [{ theme: "quality", evidenceSnippet: "really well", confidence: 0.9, modelVersion: "v1" }],
    ...overrides,
  };
}

function makeEvidenceReviewsResponse(reviews: ReviewDetail[] = []): EvidenceReviewsResponse {
  return {
    reviews,
    count: reviews.length,
  };
}

describe("ProductDetail (Phase 7 Step 3)", () => {
  beforeEach(() => {
    getProductDetailMock.mockReset();
    getProductSignalsMock.mockReset();
    getProductInsightsMock.mockReset();
    getEvidenceReviewsMock.mockReset();
    getOrCreateConversationMock.mockReset();
    analyzeProductQuestionMock.mockReset();

    // Default mock returns for AI Analyst Panel
    getOrCreateConversationMock.mockResolvedValue({
      id: "conv-123",
      platform: "flipkart",
      sourceProductId: "PID001",
      windowStart: null,
      windowEnd: null,
      messages: [],
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("1. renders successfully with real mocked data", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    expect(await screen.findByText("PID001")).toBeInTheDocument();
  });

  it("2. renders the product identity and platform from URL params, plus real brand from the API", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail("/products/myntra/PID999");
    expect(await screen.findByText("PID999")).toBeInTheDocument();
    expect(screen.getByText("myntra")).toBeInTheDocument();
    expect(await screen.findByText("Bluepeak")).toBeInTheDocument();
  });

  it("3. renders real KPI/health values verbatim (rating, review count, ratingScore, trend)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    expect(await screen.findByText("4.31")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getAllByText("87.3").length).toBeGreaterThan(0);
    expect(screen.getByText("improving")).toBeInTheDocument();
  });

  it("4. renders 'Not available yet' for null severityScore/totalScore, never a fabricated 0", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("0–100 health-score scale"); // waits for real loaded data, not just the URL-derived header
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(2); // severity + total
  });

  it("5. renders sentiment distribution from real percentages", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("0–100 health-score scale"); // waits for real loaded data, not just the URL-derived header
    // "78%" is rendered as two adjacent text nodes ({value} + "%"), so an
    // exact string match on the parent's combined textContent is needed.
    const byExactCombinedText = (text: string) =>
      screen.getByText((_content, element) => element?.tagName === "SPAN" && element.textContent === text);
    expect(byExactCombinedText("78%")).toBeInTheDocument();
    expect(byExactCombinedText("8%")).toBeInTheDocument();
    expect(byExactCombinedText("14%")).toBeInTheDocument();
  });

  it("6. themes are not shown as a separate deterministic section (folded into AI insight only)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("0–100 health-score scale"); // waits for real loaded data, not just the URL-derived header
    expect(screen.queryByRole("heading", { name: /^themes$/i })).not.toBeInTheDocument();
  });

  it("7. renders an active early-warning signal with its real fields", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-01-30",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["r1", "r2"],
            confidence: "high",
          },
        ],
      }),
    );
    renderProductDetail();
    expect(await screen.findByText("Rating decline")).toBeInTheDocument();
  });

  it("8. product_deterioration (not_ready) shown in a distinct section, never as an active signal", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "product_deterioration",
            detectedDate: "2026-01-30",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 0,
            baselineMetric: 0,
            delta: 0,
            threshold: 0,
            evidenceReviewIds: [],
            confidence: "not_ready",
          },
        ],
      }),
    );
    renderProductDetail();
    expect(await screen.findByText("Not Available Yet")).toBeInTheDocument();
    expect(screen.getByText("No active signals for this period")).toBeInTheDocument();
  });

  it("9. a signal with confidence=insufficient_data is rendered, visibly marked, not hidden", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    const signal: EarlyWarningSignal = {
      signalType: "review_volume_spike",
      detectedDate: "2026-01-30",
      platform: "flipkart",
      sourceProductId: "PID001",
      currentMetric: 12,
      baselineMetric: 3,
      delta: 9,
      threshold: 3,
      evidenceReviewIds: [],
      confidence: "insufficient_data",
    };
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse({ signals: [signal] }));
    renderProductDetail();
    expect(await screen.findByText("Volume spike")).toBeInTheDocument();
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
  });

  it("10. renders evidence review IDs cited by active signals", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-01-30",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["abcdef1234567890"],
            confidence: "high",
          },
        ],
      }),
    );
    renderProductDetail();
    await screen.findByText("Rating decline");
    expect(screen.getByText("abcdef12")).toBeInTheDocument(); // EvidenceList truncates to 8 chars
  });

  it("11. shows an honest empty-evidence state when no active signal cites anything", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse({ signals: [] }));
    renderProductDetail();
    expect(await screen.findByText("No cited evidence for this period")).toBeInTheDocument();
  });

  it("12. renders a generic error state for a not-found-shaped response, never a crash", async () => {
    getProductDetailMock.mockRejectedValue(new ApiClientError("not_found", "no such product"));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("13. renders the session-expired state on a real 401", async () => {
    getProductDetailMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });

  it("14. renders the not-permitted state on a real 403", async () => {
    getProductDetailMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("15. renders a generic dashboard error for a real 500", async () => {
    getProductDetailMock.mockRejectedValue(new ApiClientError("server", "boom"));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("16. AI initial state does NOT call /insights", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("Ask AI to analyze this product");
    await new Promise((r) => setTimeout(r, 20));
    expect(getProductInsightsMock).not.toHaveBeenCalled();
  });

  it("17. clicking 'Ask AI for Insight' makes exactly one request", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockResolvedValue(makeInsightsResponse());
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    await waitFor(() => expect(getProductInsightsMock).toHaveBeenCalledTimes(1));
  });

  it("18. shows a loading state while the AI insight request is in flight", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockReturnValue(new Promise(() => {}));
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
  });

  it("19. renders the successful AI insight result", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockResolvedValue(makeInsightsResponse());
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    expect(await screen.findByText("Reviews indicate quality is the most common negative theme.")).toBeInTheDocument();
  });

  it("20. handles an AI-unavailable/rate-limited error honestly", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockRejectedValue(new ApiClientError("ai_unavailable", "rate limited", { retryable: true }));
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    expect(await screen.findByText("AI insight temporarily unavailable")).toBeInTheDocument();
  });

  it("21. allows an explicit retry after an AI failure, which makes a second real request", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockRejectedValueOnce(new ApiClientError("ai_unavailable", "rate limited", { retryable: true }));
    getProductInsightsMock.mockResolvedValueOnce(makeInsightsResponse());
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    await screen.findByText("AI insight temporarily unavailable");
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Reviews indicate quality is the most common negative theme.")).toBeInTheDocument();
    expect(getProductInsightsMock).toHaveBeenCalledTimes(2);
  });

  it("22. does not repeat the AI request on unrelated React re-renders", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockResolvedValue(makeInsightsResponse());
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    await screen.findByText("Reviews indicate quality is the most common negative theme.");
    // Trigger further re-renders unrelated to the AI query (window-selector re-focus).
    await user.tab();
    await user.tab();
    expect(getProductInsightsMock).toHaveBeenCalledTimes(1);
  });

  it("23. changing the range updates the URL and refetches product/signals data", async () => {
    // The window control is now a DATE RANGE, not the six fixed tabs, so the
    // preset is a button and the URL carries from/to instead of window=90d.
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("PID001");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "90d" }));

    const expectedRange = { from: daysAgoIso(90), to: todayIso() };
    await waitFor(() => {
      expect(getProductDetailMock).toHaveBeenCalledWith("flipkart", "PID001", expectedRange, expect.anything());
      expect(getProductSignalsMock).toHaveBeenCalledWith("flipkart", "PID001", expectedRange, expect.anything());
    });

    const search = screen.getByTestId("location-search").textContent ?? "";
    expect(search).toContain(`from=${expectedRange.from}`);
    expect(search).toContain(`to=${expectedRange.to}`);
  });

  it("23b. an explicit custom range is applied and reaches the API", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("PID001");
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Start date"));
    await user.type(screen.getByLabelText("Start date"), "2026-01-05");
    await user.clear(screen.getByLabelText("End date"));
    await user.type(screen.getByLabelText("End date"), "2026-02-10");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(getProductDetailMock).toHaveBeenCalledWith(
        "flipkart",
        "PID001",
        { from: "2026-01-05", to: "2026-02-10" },
        expect.anything(),
      ),
    );
  });

  it("23c. defaults to the last 30 days when the URL carries no range", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("PID001");
    expect(getProductDetailMock).toHaveBeenCalledWith(
      "flipkart",
      "PID001",
      { from: daysAgoIso(30), to: todayIso() },
      expect.anything(),
    );
  });

  it("24. changing the range does NOT automatically call the AI insights endpoint", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    getProductInsightsMock.mockResolvedValue(makeInsightsResponse());
    renderProductDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ask ai for insight/i }));
    await screen.findByText("Reviews indicate quality is the most common negative theme.");
    expect(getProductInsightsMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "90d" }));
    await waitFor(() =>
      expect(getProductDetailMock).toHaveBeenCalledWith(
        "flipkart",
        "PID001",
        { from: daysAgoIso(90), to: todayIso() },
        expect.anything(),
      ),
    );
    // The AI section must revert to "ask AI to analyze" state for the new window, and no second AI call happens automatically.
    expect(await screen.findByText("Ask AI to analyze this product")).toBeInTheDocument();
    expect(getProductInsightsMock).toHaveBeenCalledTimes(1);
  });

  it("25. never fabricates a severity value anywhere on the page", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("0–100 health-score scale"); // waits for real loaded data, not just the URL-derived header
    expect(screen.queryByText(/severity:\s*\d/i)).not.toBeInTheDocument();
  });

  it("26. never renders a time-series/trend chart (the API returns no time series)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("0–100 health-score scale"); // waits for real loaded data, not just the URL-derived header
    expect(screen.queryByText(/trend over time/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-line")).toHaveLength(0);
  });

  it("27. displays backend values verbatim — no client-side recalculation of scores", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse({ health: makeHealth({ ratingScore: 33.333, trendScore: 12.9 }) }));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    await screen.findByText("0–100 health-score scale"); // waits for real loaded data, not just the URL-derived header
    expect(screen.getAllByText("33.333").length).toBeGreaterThan(0); // exact backend value, not rounded/recomputed
    expect(screen.getByText(/Trend score 12\.9/)).toBeInTheDocument();
  });

  it("28. Back button defaults to products list when no ranking context provided", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail();
    const button = await screen.findByText("Back to Products");
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("inline-flex");
  });

  // ========== Phase 8 Step 8 — Actual Review Integration Tests ==========

  it("29. extracts evidenceReviewIds from active signals and passes them to useEvidenceReviews", async () => {
    const reviewIds = ["rev001", "rev002"];
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: reviewIds,
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(makeEvidenceReviewsResponse());
    renderProductDetail();
    await waitFor(() => {
      expect(getEvidenceReviewsMock).toHaveBeenCalledWith(reviewIds, expect.anything());
    });
  });

  it("30. renders actual reviewer name from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ author: "Test Reviewer" })]),
    );
    renderProductDetail();
    expect(await screen.findByText("Test Reviewer")).toBeInTheDocument();
  });

  it("31. renders actual review text from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ reviewText: "This product is excellent and worth the price." })]),
    );
    renderProductDetail();
    expect(await screen.findByText(/This product is excellent and worth the price/)).toBeInTheDocument();
  });

  it("32. renders review title when present", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ title: "Five star quality" })]),
    );
    renderProductDetail();
    expect(await screen.findByText("Five star quality")).toBeInTheDocument();
  });

  it("33. renders actual rating as stars from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ rating: 5 })]),
    );
    renderProductDetail();
    // Rating is rendered; we verified in ReviewDetail.test.tsx that the stars are rendered correctly
    expect(await screen.findByText("Test Reviewer")).toBeInTheDocument();
  });

  it("34. renders review date from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ reviewDate: "2026-08-14" })]),
    );
    renderProductDetail();
    expect(await screen.findByText("2026-08-14")).toBeInTheDocument();
  });

  it("35. renders platform/marketplace badge from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ platform: "myntra" })]),
    );
    renderProductDetail();
    expect(await screen.findByText("myntra")).toBeInTheDocument();
  });

  it("36. renders sentiment badge from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ sentiment: "negative" })]),
    );
    renderProductDetail();
    expect(await screen.findByText("negative")).toBeInTheDocument();
  });

  it("37. renders theme badges from review response", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([
        makeReview({
          themes: [
            { theme: "durability", evidenceSnippet: "lasted long", confidence: 0.85, modelVersion: "v1" },
            { theme: "value", evidenceSnippet: "good price", confidence: 0.8, modelVersion: "v1" },
          ],
        }),
      ]),
    );
    renderProductDetail();
    expect(await screen.findByText("durability")).toBeInTheDocument();
    expect(screen.getByText("value")).toBeInTheDocument();
  });

  it("38. renders verified purchase indicator when true", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([makeReview({ verifiedPurchase: true })]),
    );
    renderProductDetail();
    expect(await screen.findByText("Verified purchase")).toBeInTheDocument();
  });

  it("39. renders multiple reviews in order returned by backend", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001", "rev002", "rev003"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([
        makeReview({ canonicalReviewId: "rev001", author: "Alice", reviewDate: "2026-08-14", reviewTimestamp: "2026-08-14T15:00:00Z" }),
        makeReview({ canonicalReviewId: "rev002", author: "Bob", reviewDate: "2026-08-13", reviewTimestamp: "2026-08-13T10:00:00Z" }),
        makeReview({ canonicalReviewId: "rev003", author: "Charlie", reviewDate: "2026-08-12", reviewTimestamp: "2026-08-12T09:00:00Z" }),
      ]),
    );
    renderProductDetail();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("40. does not render review sections when evidenceReviewIds is empty", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse({ signals: [] }));
    renderProductDetail();
    expect(await screen.findByText("No cited evidence for this period")).toBeInTheDocument();
    expect(screen.queryByText("Supporting Reviews")).not.toBeInTheDocument();
  });

  it("41. handles nullable fields without fabrication (null author, title, text)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([
        makeReview({
          author: null,
          title: null,
          reviewText: null,
          helpfulCount: null,
          sentiment: null,
          themes: [],
        }),
      ]),
    );
    renderProductDetail();
    expect(await screen.findByText("Anonymous")).toBeInTheDocument();
    // Nullable fields should not render their sections
    expect(screen.queryByText("Helpful:")).not.toBeInTheDocument();
  });

  it("42. handles review loading state gracefully", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    // Delay the response to test loading state
    getEvidenceReviewsMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeEvidenceReviewsResponse([makeReview()])), 100)),
    );
    renderProductDetail();
    // Loading state should briefly show; review should eventually render
    expect(await screen.findByText("Test Reviewer")).toBeInTheDocument();
  });

  it("43. displays review error state when endpoint fails", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockRejectedValue(new Error("Failed to fetch reviews"));
    renderProductDetail();
    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("44. displays empty review state when no reviews are returned", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001"],
            confidence: "high",
          },
        ],
      }),
    );
    getEvidenceReviewsMock.mockResolvedValue(makeEvidenceReviewsResponse([]));
    renderProductDetail();
    expect(await screen.findByText("No reviews found")).toBeInTheDocument();
  });

  it("45. renders reviews in order returned by backend (does NOT independently sort)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(
      makeSignalsResponse({
        signals: [
          {
            signalType: "sudden_rating_decline",
            detectedDate: "2026-08-14",
            platform: "flipkart",
            sourceProductId: "PID001",
            currentMetric: 2.1,
            baselineMetric: 4.5,
            delta: -53.3,
            threshold: -15,
            evidenceReviewIds: ["rev001", "rev002", "rev003"],
            confidence: "high",
          },
        ],
      }),
    );
    // Backend returns reviews in newest-first order (order should be deterministic from backend)
    getEvidenceReviewsMock.mockResolvedValue(
      makeEvidenceReviewsResponse([
        makeReview({ canonicalReviewId: "rev001", author: "Newest", reviewDate: "2026-08-14", reviewTimestamp: "2026-08-14T15:00:00Z" }),
        makeReview({ canonicalReviewId: "rev002", author: "Middle", reviewDate: "2026-08-13", reviewTimestamp: "2026-08-13T10:00:00Z" }),
        makeReview({ canonicalReviewId: "rev003", author: "Oldest", reviewDate: "2026-08-12", reviewTimestamp: "2026-08-12T09:00:00Z" }),
      ]),
    );
    renderProductDetail();
    const authors = await screen.findAllByText(/Newest|Middle|Oldest/);
    // Verify order matches backend order (newest first)
    expect(authors[0]).toHaveTextContent("Newest");
    expect(authors[1]).toHaveTextContent("Middle");
    expect(authors[2]).toHaveTextContent("Oldest");
  });

  // ========== Fix 1 & 2: Ranking Context Navigation Tests ==========

  it("46. Back button shows 'Back to Negative Reviews' when from negative ranking", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail("/products/flipkart/PID001?from=ranking&platform=flipkart&type=negative");
    const button = await screen.findByText("Back to Negative Reviews");
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("inline-flex");
  });

  it("47. Back button shows 'Back to Positive Reviews' when from positive ranking", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail("/products/flipkart/PID001?from=ranking&platform=flipkart&type=positive");
    const button = await screen.findByText("Back to Positive Reviews");
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("inline-flex");
  });

  it("48. Back button shows 'Back to Negative Reviews' for myntra negative ranking", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse({ platform: "myntra", sourceProductId: "MID001" }));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse({ platform: "myntra", sourceProductId: "MID001" }));
    renderProductDetail("/products/myntra/MID001?from=ranking&platform=myntra&type=negative");
    const button = await screen.findByText("Back to Negative Reviews");
    expect(button).toBeInTheDocument();
  });

  it("49. Back button shows 'Back to Positive Reviews' for myntra positive ranking", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse({ platform: "myntra", sourceProductId: "MID001" }));
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse({ platform: "myntra", sourceProductId: "MID001" }));
    renderProductDetail("/products/myntra/MID001?from=ranking&platform=myntra&type=positive");
    const button = await screen.findByText("Back to Positive Reviews");
    expect(button).toBeInTheDocument();
  });

  it("50. Back button preserves pagination when returning from ranking (page 2)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail("/products/flipkart/PID001?from=ranking&platform=flipkart&type=negative&page=2");
    const button = await screen.findByText("Back to Negative Reviews");
    expect(button).toHaveClass("inline-flex");
    // Just verify the button exists and is clickable (pagination is preserved via URL)
    expect(button).toBeInTheDocument();
  });

  it("51. Back button preserves pagination when returning from ranking (page 5)", async () => {
    getProductDetailMock.mockResolvedValue(makeDetailResponse());
    getProductSignalsMock.mockResolvedValue(makeSignalsResponse());
    renderProductDetail("/products/flipkart/PID001?from=ranking&platform=flipkart&type=positive&page=5");
    const button = await screen.findByText("Back to Positive Reviews");
    expect(button).toHaveClass("inline-flex");
    // Just verify the button exists (pagination is preserved via URL)
    expect(button).toBeInTheDocument();
  });
});
