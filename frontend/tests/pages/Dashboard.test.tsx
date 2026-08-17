import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { Dashboard } from "@/pages/Dashboard";
import { ApiClientError } from "@/api/errors";
import type { DashboardExecutiveResponse, EarlyWarningsResponse, ProblemsResponse, ProblemThemeSummary, HealthScore } from "@/types/api";

const { getExecutiveDashboardMock, getEarlyWarningsMock, getProblemsMock } = vi.hoisted(() => ({
  getExecutiveDashboardMock: vi.fn(),
  getEarlyWarningsMock: vi.fn(),
  getProblemsMock: vi.fn(),
}));

vi.mock("@/api/endpoints/dashboard", () => ({ getExecutiveDashboard: getExecutiveDashboardMock }));
vi.mock("@/api/endpoints/earlyWarnings", () => ({ getEarlyWarnings: getEarlyWarningsMock }));
vi.mock("@/api/endpoints/problems", () => ({ getProblems: getProblemsMock }));

function makeHealth(overrides: Partial<HealthScore> = {}): HealthScore {
  return {
    scopeType: "product",
    platform: "flipkart",
    sourceProductId: "PID001",
    ratingScore: 72.5,
    sentimentScore: 61,
    complaintScore: 88,
    severityScore: null,
    trendScore: 55,
    totalScore: null,
    version: "health-v0-hypothesis",
    weights: { rating: 0.3, sentiment: 0.25, complaint: 0.2, severity: 0.15, trend: 0.1 },
    computedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDashboardResponse(overrides: Partial<DashboardExecutiveResponse> = {}): DashboardExecutiveResponse {
  return {
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    productCount: 42,
    activeAlertCount: 3,
    averageRatingScore: 4.12,
    topMovers: [{ platform: "flipkart", sourceProductId: "PID001", brand: "Bluepeak", health: makeHealth() }],
    bottomMovers: [{ platform: "myntra", sourceProductId: "PID002", brand: "Palecove", health: makeHealth({ platform: "myntra", sourceProductId: "PID002", ratingScore: 12 }) }],
    ...overrides,
  };
}

function makeWarningsResponse(overrides: Partial<EarlyWarningsResponse> = {}): EarlyWarningsResponse {
  return {
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    filters: { platform: null, brand: null },
    productsScanned: 42,
    signals: [],
    ...overrides,
  };
}

function makeProblemTheme(overrides: Partial<ProblemThemeSummary> = {}): ProblemThemeSummary {
  return {
    theme: "quality",
    mentionCount: 42,
    distinctReviewCount: 40,
    distinctProductCount: 12,
    confidence: "high",
    ...overrides,
  };
}

function makeProblemsResponse(overrides: Partial<ProblemsResponse> = {}): ProblemsResponse {
  return {
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    filters: { platform: null, theme: null },
    themes: [],
    ...overrides,
  };
}

function renderDashboard(initialPath = "/dashboard") {
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
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard (Phase 7 Step 2)", () => {
  beforeEach(() => {
    getExecutiveDashboardMock.mockReset();
    getEarlyWarningsMock.mockReset();
    getProblemsMock.mockReset();
    // Default so every existing test not specifically about the Top
    // Problem Themes panel doesn't have to know it exists.
    getProblemsMock.mockResolvedValue(makeProblemsResponse());
  });

  it("1. renders successfully with real mocked data", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    expect(await screen.findByText("Executive Dashboard")).toBeInTheDocument();
  });

  it("2. renders the exact KPI values from the API response", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse({ productCount: 77, activeAlertCount: 9, averageRatingScore: 3.45 }));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    getProblemsMock.mockResolvedValue(makeProblemsResponse());
    renderDashboard();
    expect(await screen.findByText("77")).toBeInTheDocument();
    // activeAlertCount now renders inside the Attention section's status
    // callout ("9 active alerts"), not as a lone "9" text node — a
    // deliberate Phase 8 Step 2 restructure, not a regression.
    expect(await screen.findByText("9 active alerts")).toBeInTheDocument();
    expect(await screen.findByText("3.5")).toBeInTheDocument(); // toFixed(1) of 3.45
  });

  it("3. renders '—' for a null averageRatingScore, never 0", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse({ averageRatingScore: null }));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("4. renders the empty-catalog state when productCount is 0", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse({ productCount: 0, topMovers: [], bottomMovers: [] }));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    expect(await screen.findByText("No products ingested yet")).toBeInTheDocument();
  });

  it("5. changing the window selector requests the new window and updates the URL", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    await screen.findByText("Executive Dashboard");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "90d" }));

    await waitFor(() => {
      expect(getExecutiveDashboardMock).toHaveBeenCalledWith("90d", expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("window=90d");
  });

  it("6. shows skeleton loading UI before data resolves, not a blank page", async () => {
    getExecutiveDashboardMock.mockReturnValue(new Promise(() => {})); // never resolves
    getEarlyWarningsMock.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("7. renders a generic dashboard error state for a real ApiClientError", async () => {
    getExecutiveDashboardMock.mockRejectedValue(new ApiClientError("server", "boom"));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("8. renders the session-expired state on a real 401", async () => {
    getExecutiveDashboardMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });

  it("9. renders the not-permitted state on a real 403", async () => {
    getExecutiveDashboardMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("10. renders Top Movers using the API's own list, unmodified", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    // Waits for the real mover content itself, not just the (immediately
    // rendered, data-independent) section heading — the heading appears
    // before the async data resolves, so waiting on it alone is a race.
    await screen.findByText("Bluepeak");
    const section = screen.getByText("Top Movers").closest("section")!;
    expect(within(section).getByText("Bluepeak")).toBeInTheDocument();
    expect(within(section).getByText(/flipkart · PID001/)).toBeInTheDocument();
  });

  it("11. renders Bottom Movers using the API's own list, unmodified", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    await screen.findByText("Palecove");
    const section = screen.getByText("Bottom Movers").closest("section")!;
    expect(within(section).getByText("Palecove")).toBeInTheDocument();
    expect(within(section).getByText(/myntra · PID002/)).toBeInTheDocument();
  });

  it("12. each mover links to the exact platform/sourceProductId Product Detail URL the API returned", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    await screen.findByText("Bluepeak");
    const link = screen.getByText("Bluepeak").closest("a")!;
    expect(link).toHaveAttribute("href", "/products/flipkart/PID001");
  });

  it("13. renders an active early-warning signal with its real fields", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(
      makeWarningsResponse({
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
            evidenceReviewIds: ["a", "b", "c"],
            confidence: "high",
          },
        ],
      }),
    );
    renderDashboard();
    expect(await screen.findByText("Rating decline")).toBeInTheDocument();
    expect(screen.getByText("3 cited review(s)")).toBeInTheDocument();
  });

  it("14. shows a real, honest empty-warnings message, not an error", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse({ signals: [] }));
    renderDashboard();
    expect(await screen.findByText("No active warnings for this period")).toBeInTheDocument();
  });

  it("15. product_deterioration (not_ready) is shown in a distinct 'Not Available Yet' section, never as an active warning", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(
      makeWarningsResponse({
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
    renderDashboard();
    expect(await screen.findByText("Not Available Yet")).toBeInTheDocument();
    expect(screen.getByText(/this signal is not currently available/i)).toBeInTheDocument();
    // Must not appear in the active-warnings grid as a real fired signal.
    expect(screen.getByText("No active warnings for this period")).toBeInTheDocument();
  });

  it("16. a signal with confidence=insufficient_data is still rendered, visibly marked, not hidden or treated as an error", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(
      makeWarningsResponse({
        signals: [
          {
            signalType: "review_volume_spike",
            detectedDate: "2026-01-30",
            platform: "flipkart",
            sourceProductId: "PID003",
            currentMetric: 12,
            baselineMetric: 3,
            delta: 9,
            threshold: 3,
            evidenceReviewIds: [],
            confidence: "insufficient_data",
          },
        ],
      }),
    );
    renderDashboard();
    expect(await screen.findByText("Volume spike")).toBeInTheDocument();
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
  });

  it("17. never fabricates a severity value — severityScore/totalScore always render as 'Not available'", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    await screen.findByText("Bluepeak");
    const notAvailable = screen.getAllByText("Not available");
    // Severity score + Total score, once per mover card rendered (2 movers × 2 fields = 4).
    expect(notAvailable.length).toBe(4);
    expect(screen.queryByText(/severity:\s*\d/i)).not.toBeInTheDocument();
  });

  it("18. calls the API client with exactly the expected query parameters (window only — no invented filters)", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard("/dashboard?window=60d");
    await waitFor(() => {
      expect(getExecutiveDashboardMock).toHaveBeenCalledWith("60d", expect.anything());
      expect(getEarlyWarningsMock).toHaveBeenCalledWith({ window: "60d" }, expect.anything());
      expect(getProblemsMock).toHaveBeenCalledWith({ window: "60d" }, expect.anything());
    });
  });

  it("19. renders the Top Problem Themes panel with the backend's own values, never re-sorted or re-scored", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    getProblemsMock.mockResolvedValue(
      makeProblemsResponse({
        themes: [
          makeProblemTheme({ theme: "quality", mentionCount: 90, distinctProductCount: 30, confidence: "high" }),
          makeProblemTheme({ theme: "size", mentionCount: 40, distinctProductCount: 10, confidence: "medium" }),
        ],
      }),
    );
    renderDashboard();
    const panel = (await screen.findByText("quality")).closest("section")!;
    expect(within(panel).getByText("90 mentions · 30 products")).toBeInTheDocument();
    expect(within(panel).getByText("High confidence")).toBeInTheDocument();
    expect(within(panel).getByText("size")).toBeInTheDocument();
    // No severity/priority/score language anywhere near the panel.
    expect(within(panel).queryByText(/severity|priority|score/i)).not.toBeInTheDocument();
  });

  it("20. shows only the backend's real top-N problem themes, a presentational trim, not a new ranking", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    getProblemsMock.mockResolvedValue(
      makeProblemsResponse({
        themes: [
          makeProblemTheme({ theme: "quality" }),
          makeProblemTheme({ theme: "size" }),
          makeProblemTheme({ theme: "fit" }),
          makeProblemTheme({ theme: "color" }),
          makeProblemTheme({ theme: "delivery" }),
        ],
      }),
    );
    renderDashboard();
    await screen.findByText("quality");
    expect(screen.getByText("size")).toBeInTheDocument();
    expect(screen.getByText("fit")).toBeInTheDocument();
    // Backend already returns 5 themes in its own sorted order — the
    // dashboard summary shows only the first 3 of that real order.
    expect(screen.queryByText("color")).not.toBeInTheDocument();
    expect(screen.queryByText("delivery")).not.toBeInTheDocument();
  });

  it("21. shows an honest empty state when there are zero problem themes for the period", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    getProblemsMock.mockResolvedValue(makeProblemsResponse({ themes: [] }));
    renderDashboard();
    expect(await screen.findByText("No recurring problems found for this period")).toBeInTheDocument();
  });

  it("22. shows the problems section's own error state independently, without blocking the rest of the dashboard", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    getProblemsMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderDashboard();
    await screen.findByText("Bluepeak"); // movers still render
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("23. the Attention status callout reads a warning tone with real count text when activeAlertCount > 0", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse({ activeAlertCount: 5 }));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    const badge = await screen.findByText("5 active alerts");
    expect(badge.className).toContain("bg-warning-bg");
  });

  it("24. the Attention status callout reads a success tone with honest singular/zero text when activeAlertCount is 0", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse({ activeAlertCount: 0 }));
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    const badge = await screen.findByText("0 active alerts");
    expect(badge.className).toContain("bg-success-bg");
  });

  it("25. provides real navigation links to Rankings, Warnings, Problems, and Marketplace, with window propagated where the destination page supports it", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard("/dashboard?window=90d");
    await screen.findByText("Bluepeak");
    expect(screen.getByRole("link", { name: /browse full catalog/i })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: /view all warnings/i })).toHaveAttribute("href", "/warnings?window=90d");
    expect(screen.getByRole("link", { name: /view all problems/i })).toHaveAttribute("href", "/problems?window=90d");
    expect(screen.getByRole("link", { name: "Rankings" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: /compare marketplaces/i })).toHaveAttribute("href", "/marketplace/brands");
  });

  it("26. Early Warnings and Top Problem Themes are labeled sub-sections within the Attention landmark", async () => {
    getExecutiveDashboardMock.mockResolvedValue(makeDashboardResponse());
    getEarlyWarningsMock.mockResolvedValue(makeWarningsResponse());
    renderDashboard();
    const attention = (await screen.findByRole("heading", { name: "Attention", level: 2 })).closest("section")!;
    expect(within(attention).getByText("Early warnings")).toBeInTheDocument();
    expect(within(attention).getByText("Top problem themes")).toBeInTheDocument();
  });
});
