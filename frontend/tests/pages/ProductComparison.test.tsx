import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProductComparison } from "@/pages/ProductComparison";
import { ApiClientError } from "@/api/errors";
import type { ProductMarketplaceComparison, ProductAnalytics, CoreMetrics } from "@/types/api";

const { getProductFamilyComparisonMock } = vi.hoisted(() => ({ getProductFamilyComparisonMock: vi.fn() }));
vi.mock("@/api/endpoints/marketplace", () => ({ getProductFamilyComparison: getProductFamilyComparisonMock }));

const FAMILY_ID = "11111111-1111-1111-1111-111111111111";

function makeCoreMetrics(overrides: Partial<CoreMetrics> = {}): CoreMetrics {
  return {
    totalReviews: 40,
    averageRating: 4.1,
    ratingDistribution: { 1: 2, 2: 2, 3: 6, 4: 14, 5: 16 },
    ratingPercentages: { 1: 5, 2: 5, 3: 15, 4: 35, 5: 40 },
    positivePercentage: 75,
    negativePercentage: 10,
    neutralPercentage: 15,
    reviewVelocity: 1.3,
    uniqueProducts: 1,
    confidence: "high",
    ...overrides,
  };
}

function makeProductAnalytics(overrides: Partial<ProductAnalytics> = {}): ProductAnalytics {
  return {
    platform: "flipkart",
    sourceProductId: "FKPID000001",
    brand: "Bluepeak",
    brandInconsistent: false,
    recentMetrics: makeCoreMetrics(),
    historicalMetrics: makeCoreMetrics({ averageRating: 3.9 }),
    ratingComparison: { current: 4.1, previous: 3.9, absoluteDelta: 0.2, percentageDelta: 5.1 },
    trendDirection: "improving",
    ...overrides,
  };
}

function makeAvailableResponse(overrides: Partial<Extract<ProductMarketplaceComparison, { available: true }>> = {}): ProductMarketplaceComparison {
  return {
    available: true,
    familyId: FAMILY_ID,
    flipkartSourceProductId: "FKPID000001",
    myntraSourceProductId: "100406",
    window: { start: "2026-01-01", end: "2026-01-30" },
    flipkart: makeProductAnalytics({ platform: "flipkart", sourceProductId: "FKPID000001" }),
    myntra: makeProductAnalytics({ platform: "myntra", sourceProductId: "100406", recentMetrics: makeCoreMetrics({ averageRating: 3.7 }) }),
    ratingComparison: { current: 4.1, previous: 3.7, absoluteDelta: 0.4, percentageDelta: 10.8 },
    ...overrides,
  };
}

function makeNoMappingResponse(familyId = FAMILY_ID): ProductMarketplaceComparison {
  return { available: false, familyId, reason: "no_mapping" };
}

function renderProductComparison(initialPath = `/marketplace/products/${FAMILY_ID}`) {
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
          <Route path="/marketplace/products/:familyId" element={<ProductComparison />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The page's family-id caption and "Product Comparison" heading render
// unconditionally from the URL, independent of query state — the same
// class of false load-wait proxy flagged in Steps 5-7. Every wait here
// targets a platform card specifically instead.
async function findPlatformCard(label: "Flipkart" | "Myntra") {
  const matches = await screen.findAllByText(label);
  const card = matches.map((el) => el.closest('[data-slot="card"]')).find((el): el is HTMLElement => el !== null);
  if (!card) throw new Error(`No card found for ${label}`);
  return card;
}

describe("ProductComparison (Phase 7 Step 8)", () => {
  beforeEach(() => {
    getProductFamilyComparisonMock.mockReset();
  });

  it("1. renders successfully with real mocked available:true data", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeAvailableResponse());
    renderProductComparison();
    expect(await findPlatformCard("Flipkart")).toBeInTheDocument();
  });

  it("2. shows exact backend-returned Flipkart values", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(
      makeAvailableResponse({
        flipkartSourceProductId: "FKPID000042",
        flipkart: makeProductAnalytics({ platform: "flipkart", sourceProductId: "FKPID000042", recentMetrics: makeCoreMetrics({ totalReviews: 61, averageRating: 4.33 }) }),
      }),
    );
    renderProductComparison();
    const card = await findPlatformCard("Flipkart");
    expect(within(card).getByText("FKPID000042")).toBeInTheDocument();
    expect(within(card).getByText("61")).toBeInTheDocument();
    expect(within(card).getByText("4.33")).toBeInTheDocument();
  });

  it("3. shows exact backend-returned Myntra values", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(
      makeAvailableResponse({
        myntraSourceProductId: "100999",
        myntra: makeProductAnalytics({ platform: "myntra", sourceProductId: "100999", recentMetrics: makeCoreMetrics({ totalReviews: 27, averageRating: 3.21 }) }),
      }),
    );
    renderProductComparison();
    const card = await findPlatformCard("Myntra");
    expect(within(card).getByText("100999")).toBeInTheDocument();
    expect(within(card).getByText("27")).toBeInTheDocument();
    expect(within(card).getByText("3.21")).toBeInTheDocument();
  });

  it("4. shows the exact backend-computed comparison (rating-gap) values", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(
      makeAvailableResponse({ ratingComparison: { current: 4.6, previous: 3.4, absoluteDelta: 1.2, percentageDelta: 35.29 } }),
    );
    renderProductComparison();
    await screen.findByText("Rating gap (Flipkart − Myntra)");
    expect(screen.getByText("4.60")).toBeInTheDocument();
    expect(screen.getByText("3.40")).toBeInTheDocument();
    expect(screen.getByText("1.20")).toBeInTheDocument();
    expect(screen.getByText("(35.29%)")).toBeInTheDocument();
  });

  it("5. shows the correct family/product identity from the response and URL", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeAvailableResponse());
    renderProductComparison();
    await findPlatformCard("Flipkart");
    expect(screen.getByText(FAMILY_ID)).toBeInTheDocument();
    expect(screen.getByText("FKPID000001")).toBeInTheDocument();
    expect(screen.getByText("100406")).toBeInTheDocument();
  });

  it("6. renders the full comparison UI for the available:true state", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeAvailableResponse());
    renderProductComparison();
    await findPlatformCard("Flipkart");
    expect(screen.queryByText("Not linked to a comparable product")).not.toBeInTheDocument();
  });

  it("7. renders the honest no_mapping state when the backend reports no mapping", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeNoMappingResponse());
    renderProductComparison();
    expect(await screen.findByText("Not linked to a comparable product")).toBeInTheDocument();
    expect(screen.getByText("This product is not linked to a corresponding product on the other marketplace.")).toBeInTheDocument();
  });

  it("8. renders insufficient_data confidence honestly on the available:true state", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(
      makeAvailableResponse({ flipkart: makeProductAnalytics({ platform: "flipkart", recentMetrics: makeCoreMetrics({ confidence: "insufficient_data" }) }) }),
    );
    renderProductComparison();
    const card = await findPlatformCard("Flipkart");
    expect(within(card).getByText("Not enough data")).toBeInTheDocument();
  });

  it("9. renders null averageRating as '—', never a fabricated 0, and suppresses the rating-gap card", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(
      makeAvailableResponse({
        flipkart: makeProductAnalytics({ platform: "flipkart", recentMetrics: makeCoreMetrics({ totalReviews: 0, averageRating: null, confidence: "insufficient_data" }) }),
      }),
    );
    renderProductComparison();
    const card = await findPlatformCard("Flipkart");
    expect(within(card).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Rating gap (Flipkart − Myntra)")).not.toBeInTheDocument();
  });

  it("10. shows skeleton loading UI before data resolves", async () => {
    getProductFamilyComparisonMock.mockReturnValue(new Promise(() => {}));
    renderProductComparison();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("11. renders the session-expired state on a real 401", async () => {
    getProductFamilyComparisonMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    renderProductComparison();
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });

  it("12. renders the not-permitted state on a real 403", async () => {
    getProductFamilyComparisonMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    renderProductComparison();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("13. renders a generic error for a real 500/network failure", async () => {
    getProductFamilyComparisonMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderProductComparison();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("14. retry re-issues the request after a failure", async () => {
    getProductFamilyComparisonMock.mockRejectedValueOnce(new ApiClientError("server", "boom"));
    getProductFamilyComparisonMock.mockResolvedValueOnce(makeAvailableResponse());
    renderProductComparison();
    await screen.findByText("Something went wrong");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await findPlatformCard("Flipkart");
    expect(getProductFamilyComparisonMock).toHaveBeenCalledTimes(2);
  });

  it("15. correct route/query parameter handling: familyId from the route, window round-trips through the URL", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeAvailableResponse());
    renderProductComparison(`/marketplace/products/${FAMILY_ID}?window=60d`);
    await waitFor(() => {
      expect(getProductFamilyComparisonMock).toHaveBeenCalledWith(FAMILY_ID, "60d", expect.anything());
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "90d" }));
    await waitFor(() => {
      expect(getProductFamilyComparisonMock).toHaveBeenCalledWith(FAMILY_ID, "90d", expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("window=90d");
  });

  it("16. never fabricates a cross-platform product-ID match when no mapping exists", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeNoMappingResponse());
    renderProductComparison();
    await screen.findByText("Not linked to a comparable product");
    expect(screen.queryAllByRole("link", { name: /PID|FKPID|^\d+$/i })).toHaveLength(0);
    expect(screen.queryByText(/flipkartSourceProductId|myntraSourceProductId/i)).not.toBeInTheDocument();
  });

  it("17. performs no client-side analytics — every displayed number is exactly the backend's, one API call per load", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(
      makeAvailableResponse({ ratingComparison: { current: 4.05, previous: 3.95, absoluteDelta: 0.1, percentageDelta: 2.53 } }),
    );
    renderProductComparison();
    await screen.findByText("Rating gap (Flipkart − Myntra)");
    expect(screen.getByText("4.05")).toBeInTheDocument();
    expect(screen.getByText("3.95")).toBeInTheDocument();
    expect(getProductFamilyComparisonMock).toHaveBeenCalledTimes(1);
  });

  it("18. requests exactly (familyId, window, signal) — no invented parameters", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeAvailableResponse());
    renderProductComparison();
    await findPlatformCard("Flipkart");
    expect(getProductFamilyComparisonMock).toHaveBeenCalledWith(FAMILY_ID, "30d", expect.anything());
    expect(getProductFamilyComparisonMock.mock.calls[0]).toHaveLength(3);
  });

  it("19. shows a working 'Back to Marketplace' navigation link", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeAvailableResponse());
    renderProductComparison();
    const backLink = await screen.findByRole("link", { name: /back to marketplace/i });
    expect(backLink).toHaveAttribute("href", "/marketplace/brands");
  });

  it("20. explicitly does not manufacture any comparison numbers when mapping is absent", async () => {
    getProductFamilyComparisonMock.mockResolvedValue(makeNoMappingResponse());
    renderProductComparison();
    await screen.findByText("Not linked to a comparable product");
    expect(screen.queryByText("Rating gap (Flipkart − Myntra)")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+\.\d{2}$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
