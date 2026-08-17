import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Products } from "@/pages/Products";
import { ApiClientError } from "@/api/errors";
import type { RankingsResponse, RankingsResponseItem, HealthScore, ProductAnalytics } from "@/types/api";

const { getProductRankingsMock, useIsMobileMock } = vi.hoisted(() => ({
  getProductRankingsMock: vi.fn(),
  useIsMobileMock: vi.fn(() => false),
}));
vi.mock("@/api/endpoints/rankings", () => ({ getProductRankings: getProductRankingsMock }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: useIsMobileMock }));

function makeHealthItem(overrides: Partial<RankingsResponseItem> = {}): RankingsResponseItem {
  const health: HealthScore = {
    scopeType: "product",
    platform: "flipkart",
    sourceProductId: "PID001",
    ratingScore: 87.5,
    sentimentScore: 61,
    complaintScore: 88,
    severityScore: null,
    trendScore: 55,
    totalScore: null,
    version: "health-v0-hypothesis",
    weights: { rating: 0.3, sentiment: 0.25, complaint: 0.2, severity: 0.15, trend: 0.1 },
    computedAt: "2026-01-01T00:00:00.000Z",
  };
  return { platform: "flipkart", sourceProductId: "PID001", brand: "Bluepeak", sortValue: 87.5, data: health, ...overrides };
}

function makeRatingItem(overrides: Partial<RankingsResponseItem> = {}): RankingsResponseItem {
  const analytics: ProductAnalytics = {
    platform: "flipkart",
    sourceProductId: "PID002",
    brand: "Palecove",
    brandInconsistent: false,
    recentMetrics: {
      totalReviews: 42,
      averageRating: 4.12,
      ratingDistribution: { 1: 1, 2: 1, 3: 4, 4: 16, 5: 20 },
      ratingPercentages: { 1: 2, 2: 2, 3: 10, 4: 38, 5: 48 },
      positivePercentage: 86,
      negativePercentage: 5,
      neutralPercentage: 9,
      reviewVelocity: 1.4,
      uniqueProducts: 1,
      confidence: "high",
    },
    historicalMetrics: {
      totalReviews: 30,
      averageRating: 4.0,
      ratingDistribution: { 1: 1, 2: 1, 3: 3, 4: 10, 5: 15 },
      ratingPercentages: { 1: 3, 2: 3, 3: 10, 4: 33, 5: 50 },
      positivePercentage: 83,
      negativePercentage: 7,
      neutralPercentage: 10,
      reviewVelocity: 1,
      uniqueProducts: 1,
      confidence: "high",
    },
    ratingComparison: { current: 4.12, previous: 4.0, absoluteDelta: 0.12, percentageDelta: 3 },
    trendDirection: "improving",
  };
  return { platform: "flipkart", sourceProductId: "PID002", brand: "Palecove", sortValue: 4.12, data: analytics, ...overrides };
}

function makeResponse(overrides: Partial<RankingsResponse> = {}): RankingsResponse {
  return {
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    sort: "health",
    page: 1,
    pageSize: 20,
    totalCount: 1,
    items: [makeHealthItem()],
    ...overrides,
  };
}

function renderProducts(initialPath = "/products") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
  }
  return render(
    // Phase 8 Step 3: RankingsTable's Trend-score header tooltip needs
    // TooltipProvider in the tree — the real app already provides it via
    // AppShell; this test renders the page directly, so it must supply
    // the same context.
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationProbe />
          <Routes>
            <Route path="/products" element={<Products />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

describe("Products / Rankings (Phase 7 Step 4)", () => {
  beforeEach(() => {
    getProductRankingsMock.mockReset();
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);
  });

  it("1. renders successfully with real mocked data", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    expect(await screen.findByText("Product Rankings")).toBeInTheDocument();
  });

  it("2. sort=health shows real HealthScore columns, severity/total as 'Not available'", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.getAllByText("87.5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("55").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not available").length).toBe(2); // severity + total
  });

  it("3. sort=rating shows real ProductAnalytics columns with a confidence badge", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse({ sort: "rating", items: [makeRatingItem()] }));
    renderProducts("/products?sort=rating");
    await screen.findByText("PID002");
    expect(screen.getByText("4.12")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
  });

  it("4. each row links to the exact Product Detail URL the API returned", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    const link = await screen.findByText("PID001");
    expect(link.closest("a")).toHaveAttribute("href", "/products/flipkart/PID001");
  });

  it("5. shows an honest empty state when no products match", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse({ items: [], totalCount: 0 }));
    renderProducts();
    expect(await screen.findByText("No products match these filters")).toBeInTheDocument();
  });

  it("6. shows skeleton loading UI before data resolves", async () => {
    getProductRankingsMock.mockReturnValue(new Promise(() => {}));
    renderProducts();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("7. renders the not-permitted state on a real 403", async () => {
    getProductRankingsMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    renderProducts();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("8. renders a generic error for a real 500", async () => {
    getProductRankingsMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderProducts();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("9. changing sort updates the URL and requests the new sort", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Rating" }));
    await waitFor(() => {
      expect(getProductRankingsMock).toHaveBeenCalledWith(expect.objectContaining({ sort: "rating" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("sort=rating");
  });

  it("10. changing the platform filter requests the new platform and resets to page 1", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts("/products?page=2");
    await screen.findByText("PID001");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Flipkart" }));
    await waitFor(() => {
      expect(getProductRankingsMock).toHaveBeenCalledWith(expect.objectContaining({ platform: "flipkart", page: 1 }), expect.anything());
    });
  });

  it("11. applying a brand filter sends the exact string, clearing removes it from the URL", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/brand/i), "Bluepeak");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(getProductRankingsMock).toHaveBeenCalledWith(expect.objectContaining({ brand: "Bluepeak" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("brand=Bluepeak");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    // Returning to a query key already fetched at mount (brand=undefined) is
    // correctly served from TanStack Query's cache within staleTime, not a
    // second network call — this asserts the URL/filter state is genuinely
    // cleared, not that a redundant fetch happened (it correctly doesn't).
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).not.toContain("brand=");
    });
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("12. pagination: Next requests page 2; Previous is disabled on page 1", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse({ totalCount: 50, pageSize: 20, page: 1 }));
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(getProductRankingsMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }), expect.anything());
    });
  });

  it("13. Next is disabled on the last page", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse({ totalCount: 20, pageSize: 20, page: 1 }));
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("14. changing the window resets to page 1 and requests the new window", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts("/products?page=3");
    await screen.findByText("PID001");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "90d" }));
    await waitFor(() => {
      expect(getProductRankingsMock).toHaveBeenCalledWith(expect.objectContaining({ window: "90d", page: 1 }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("window=90d");
  });

  it("15. never fabricates a severity value or ranking anywhere on the page", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.queryByText(/severity:\s*\d/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /severity/i })).not.toBeInTheDocument();
  });

  it("16. a null averageRating (sort=rating) renders '—', never a fabricated 0", async () => {
    getProductRankingsMock.mockResolvedValue(
      makeResponse({
        sort: "rating",
        items: [
          makeRatingItem({
            sortValue: null,
            data: {
              ...makeRatingItem().data,
              recentMetrics: { ...(makeRatingItem().data as ProductAnalytics).recentMetrics, averageRating: null, confidence: "insufficient_data" },
            } as ProductAnalytics,
          }),
        ],
      }),
    );
    renderProducts("/products?sort=rating");
    await screen.findByText("PID002");
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
  });

  it("17. respects sort/platform/page from the initial URL", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse({ sort: "rating", page: 2, items: [makeRatingItem()] }));
    renderProducts("/products?sort=rating&platform=myntra&page=2");
    await waitFor(() => {
      expect(getProductRankingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "rating", platform: "myntra", page: 2 }),
        expect.anything(),
      );
    });
  });

  it("18. only sends the documented query parameters — no invented filter fields", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    const call = getProductRankingsMock.mock.calls[0]![0];
    expect(Object.keys(call).sort()).toEqual(["brand", "page", "pageSize", "platform", "sort", "window"].sort());
  });

  it("19. renders the session-expired state on a real 401", async () => {
    getProductRankingsMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    renderProducts();
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });

  it("20. sort=rating shows the real, backend-provided trendDirection — never a client-computed label", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse({ sort: "rating", items: [makeRatingItem()] }));
    renderProducts("/products?sort=rating");
    await screen.findByText("PID002");
    expect(screen.getByText("Improving")).toBeInTheDocument();
  });

  it("21. the actively-sorted metric column is marked aria-sort='descending', matching the backend's real, always-descending order", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.getByRole("columnheader", { name: "Rating score" })).toHaveAttribute("aria-sort", "descending");
  });

  it("22. the Trend score header has an explanatory tooltip, not a computed trend value", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    const user = userEvent.setup();
    await user.hover(screen.getByText("Trend score"));
    expect(await screen.findByText(/centered at 50/i)).toBeInTheDocument();
  });

  it("23. shows real, removable filter chips reflecting the current platform/brand filters", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts("/products?platform=flipkart&brand=Bluepeak");
    await screen.findByText("PID001");
    expect(screen.getByRole("button", { name: /remove platform filter \(flipkart\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove brand filter \(Bluepeak\)/i })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /remove platform filter/i }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).not.toContain("platform=");
    });
  });

  it("24. renders the dedicated mobile card layout (not the desktop table) when the viewport is mobile", async () => {
    useIsMobileMock.mockReturnValue(true);
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    // The mobile layout renders no <table> at all.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // The real catalog position, derived from the real page/pageSize/index.
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("25. renders the desktop table (not mobile cards) when the viewport is not mobile", async () => {
    useIsMobileMock.mockReturnValue(false);
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });

  it("26. never performs a duplicate rankings request for an unchanged query state (a benign UI-only interaction is re-render safe)", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    const callsAfterMount = getProductRankingsMock.mock.calls.length;
    // Hovering the Trend-score tooltip trigger causes a real React state
    // update (open/close) with no filter/window/sort/page change — that
    // must not fire a second network request; TanStack Query dedupes an
    // unchanged query key regardless of how many times the component
    // re-renders around it.
    const user = userEvent.setup();
    await user.hover(screen.getByText("Trend score"));
    await screen.findByText(/centered at 50/i);
    expect(getProductRankingsMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("27. renders no AI-related content on this page — Product Rankings has no AI surface", async () => {
    getProductRankingsMock.mockResolvedValue(makeResponse());
    renderProducts();
    await screen.findByText("PID001");
    expect(screen.queryByText(/AI insight|generate insight|ask ai/i)).not.toBeInTheDocument();
  });
});
