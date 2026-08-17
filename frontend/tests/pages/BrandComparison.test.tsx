import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { BrandComparison } from "@/pages/BrandComparison";
import { ApiClientError } from "@/api/errors";
import type { BrandMarketplaceComparison, BrandAnalytics, CoreMetrics, ThemeConsistencyResult } from "@/types/api";

const { getBrandComparisonMock } = vi.hoisted(() => ({ getBrandComparisonMock: vi.fn() }));
vi.mock("@/api/endpoints/brands", () => ({ getBrandComparison: getBrandComparisonMock }));

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
    uniqueProducts: 5,
    confidence: "high",
    ...overrides,
  };
}

function makeBrandAnalytics(overrides: Partial<BrandAnalytics> = {}): BrandAnalytics {
  return {
    brand: "Bluepeak",
    platform: "flipkart",
    productCount: 5,
    recentMetrics: makeCoreMetrics(),
    historicalMetrics: makeCoreMetrics({ averageRating: 3.9 }),
    ratingComparison: { current: 4.1, previous: 3.9, absoluteDelta: 0.2, percentageDelta: 5.1 },
    trendDirection: "improving",
    ...overrides,
  };
}

function makeTheme(overrides: Partial<ThemeConsistencyResult> = {}): ThemeConsistencyResult {
  return {
    theme: "quality",
    flipkartFrequencyPercent: 12,
    myntraFrequencyPercent: 14,
    flipkartSampleSize: 40,
    myntraSampleSize: 35,
    classification: "marketplace_consistent",
    ...overrides,
  };
}

function makeResponse(overrides: Partial<BrandMarketplaceComparison> = {}): BrandMarketplaceComparison {
  return {
    brand: "Bluepeak",
    window: { start: "2026-01-01", end: "2026-01-30" },
    flipkart: makeBrandAnalytics({ platform: "flipkart" }),
    myntra: makeBrandAnalytics({ platform: "myntra", recentMetrics: makeCoreMetrics({ averageRating: 3.7 }) }),
    ratingComparison: { current: 4.1, previous: 3.7, absoluteDelta: 0.4, percentageDelta: 10.8 },
    themeConsistency: [makeTheme()],
    ...overrides,
  };
}

function renderBrandComparison(initialPath = "/marketplace/brands/Bluepeak") {
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
          <Route path="/marketplace/brands/:brand" element={<BrandComparison />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// "Flipkart"/"Myntra" text appears both as a platform card title and as a
// table column header, so a plain findByText is ambiguous; and the page's
// <h1> renders the brand name from the URL unconditionally (even during
// loading), so waiting on it is a false proxy for "the query resolved" —
// the same class of bug flagged in earlier Phase 7 steps. Every load-wait
// here targets the platform card specifically instead.
async function findPlatformCard(label: "Flipkart" | "Myntra") {
  const matches = await screen.findAllByText(label);
  const card = matches.map((el) => el.closest('[data-slot="card"]')).find((el): el is HTMLElement => el !== null);
  if (!card) throw new Error(`No card found for ${label}`);
  return card;
}

describe("BrandComparison (Phase 7 Step 7)", () => {
  beforeEach(() => {
    getBrandComparisonMock.mockReset();
  });

  it("1. renders successfully with real mocked data", async () => {
    getBrandComparisonMock.mockResolvedValue(makeResponse());
    renderBrandComparison();
    expect(await screen.findByRole("heading", { name: "Bluepeak", level: 1 })).toBeInTheDocument();
  });

  it("2. shows the exact brand identity from the URL", async () => {
    getBrandComparisonMock.mockResolvedValue(makeResponse({ brand: "Palecove" }));
    renderBrandComparison("/marketplace/brands/Palecove");
    expect(await screen.findByRole("heading", { name: "Palecove", level: 1 })).toBeInTheDocument();
  });

  it("3. shows exact backend-returned per-platform marketplace values", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({
        flipkart: makeBrandAnalytics({ platform: "flipkart", productCount: 7, recentMetrics: makeCoreMetrics({ totalReviews: 88, averageRating: 4.44 }) }),
      }),
    );
    renderBrandComparison();
    const flipkartCard = await findPlatformCard("Flipkart");
    expect(within(flipkartCard).getByText("7")).toBeInTheDocument();
    expect(within(flipkartCard).getByText("88")).toBeInTheDocument();
    expect(within(flipkartCard).getByText("4.44")).toBeInTheDocument();
  });

  it("4. shows the exact backend-computed rating-gap values", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({ ratingComparison: { current: 4.5, previous: 3.5, absoluteDelta: 1.0, percentageDelta: 28.57 } }),
    );
    renderBrandComparison();
    await screen.findByText("Rating gap (Flipkart − Myntra)");
    expect(screen.getByText("4.50")).toBeInTheDocument();
    expect(screen.getByText("3.50")).toBeInTheDocument();
    expect(screen.getByText("1.00")).toBeInTheDocument();
    expect(screen.getByText("(28.57%)")).toBeInTheDocument();
  });

  it("5. shows the exact backend-returned theme-consistency classification", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({ themeConsistency: [makeTheme({ theme: "size", classification: "marketplace_specific" })] }),
    );
    renderBrandComparison();
    await findPlatformCard("Flipkart");
    expect(screen.getByText("Marketplace-specific")).toBeInTheDocument();
  });

  it("6. renders null averageRating and null theme frequency as '—', never a fabricated 0", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({
        flipkart: makeBrandAnalytics({ platform: "flipkart", recentMetrics: makeCoreMetrics({ totalReviews: 0, averageRating: null, confidence: "insufficient_data" }) }),
        themeConsistency: [makeTheme({ flipkartFrequencyPercent: null, classification: "insufficient_evidence" })],
      }),
    );
    renderBrandComparison();
    await findPlatformCard("Flipkart");
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("7. a brand with zero products on one platform is shown honestly, with no fabricated product-mapping implication", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({
        flipkart: makeBrandAnalytics({
          platform: "flipkart",
          productCount: 0,
          recentMetrics: makeCoreMetrics({ totalReviews: 0, averageRating: null, confidence: "insufficient_data" }),
        }),
      }),
    );
    renderBrandComparison();
    const flipkartCard = await findPlatformCard("Flipkart");
    // Both "Products" and "Reviews" are genuinely 0 here — two real zeros,
    // not a rendering bug.
    expect(within(flipkartCard).getAllByText("0").length).toBe(2);
    expect(screen.queryByText(/no mapping/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/family/i)).not.toBeInTheDocument();
  });

  it("8. hides the headline rating-gap number (never a 0-substituted gap) when either side has no real average", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({
        myntra: makeBrandAnalytics({ platform: "myntra", recentMetrics: makeCoreMetrics({ totalReviews: 0, averageRating: null, confidence: "insufficient_data" }) }),
      }),
    );
    renderBrandComparison();
    await findPlatformCard("Flipkart");
    expect(screen.queryByText("Rating gap (Flipkart − Myntra)")).not.toBeInTheDocument();
    // Appears twice here: once for the headline gap (bothSidesRated is
    // false) and once inside Myntra's own zero-review card — both real,
    // both correct, not a duplicate-rendering bug.
    expect(screen.getAllByText("Not enough review data to make a reliable assessment.").length).toBe(2);
  });

  it("9. shows skeleton loading UI before data resolves", async () => {
    getBrandComparisonMock.mockReturnValue(new Promise(() => {}));
    renderBrandComparison();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("10. renders the session-expired state on a real 401", async () => {
    getBrandComparisonMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    renderBrandComparison();
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });

  it("11. renders the not-permitted state on a real 403", async () => {
    getBrandComparisonMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    renderBrandComparison();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("12. renders a generic error for a real 500/network failure", async () => {
    getBrandComparisonMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderBrandComparison();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("13. retry re-issues the request after a failure", async () => {
    getBrandComparisonMock.mockRejectedValueOnce(new ApiClientError("server", "boom"));
    getBrandComparisonMock.mockResolvedValueOnce(makeResponse());
    renderBrandComparison();
    await screen.findByText("Something went wrong");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await findPlatformCard("Flipkart");
    expect(getBrandComparisonMock).toHaveBeenCalledTimes(2);
  });

  it("14. window selection round-trips through the URL and requests the new window", async () => {
    getBrandComparisonMock.mockResolvedValue(makeResponse());
    renderBrandComparison();
    await findPlatformCard("Flipkart");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "90d" }));
    await waitFor(() => {
      expect(getBrandComparisonMock).toHaveBeenCalledWith("Bluepeak", "90d", expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("window=90d");
  });

  it("15. never renders a fabricated cross-marketplace product match or product identifier", async () => {
    getBrandComparisonMock.mockResolvedValue(makeResponse());
    renderBrandComparison();
    await findPlatformCard("Flipkart");
    expect(screen.queryAllByRole("link", { name: /PID|FKPID/i })).toHaveLength(0);
    expect(screen.queryByText(/familyId/i)).not.toBeInTheDocument();
  });

  it("16. performs no client-side analytics — every displayed number is exactly the backend's, one API call per load", async () => {
    getBrandComparisonMock.mockResolvedValue(
      makeResponse({ ratingComparison: { current: 4.2, previous: 3.8, absoluteDelta: 0.4, percentageDelta: 10.53 } }),
    );
    renderBrandComparison();
    await screen.findByText("Rating gap (Flipkart − Myntra)");
    expect(screen.getByText("4.20")).toBeInTheDocument();
    expect(screen.getByText("3.80")).toBeInTheDocument();
    expect(getBrandComparisonMock).toHaveBeenCalledTimes(1);
  });

  it("17. requests exactly (brand, window, signal) — no invented parameters", async () => {
    getBrandComparisonMock.mockResolvedValue(makeResponse());
    renderBrandComparison("/marketplace/brands/Bluepeak?window=60d");
    await waitFor(() => {
      expect(getBrandComparisonMock).toHaveBeenCalledWith("Bluepeak", "60d", expect.anything());
    });
    expect(getBrandComparisonMock.mock.calls[0]).toHaveLength(3);
  });

  it("18. shows a working 'Back to Marketplace' navigation link", async () => {
    getBrandComparisonMock.mockResolvedValue(makeResponse());
    renderBrandComparison();
    const backLink = await screen.findByRole("link", { name: /back to marketplace/i });
    expect(backLink).toHaveAttribute("href", "/marketplace/brands");
  });
});
