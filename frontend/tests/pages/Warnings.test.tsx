import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { Warnings } from "@/pages/Warnings";
import { ApiClientError } from "@/api/errors";
import type { EarlyWarningsResponse, EarlyWarningSignal } from "@/types/api";

const { getEarlyWarningsMock } = vi.hoisted(() => ({ getEarlyWarningsMock: vi.fn() }));
vi.mock("@/api/endpoints/earlyWarnings", () => ({ getEarlyWarnings: getEarlyWarningsMock }));

function makeSignal(overrides: Partial<EarlyWarningSignal> = {}): EarlyWarningSignal {
  return {
    signalType: "sudden_rating_decline",
    detectedDate: "2026-01-15",
    platform: "flipkart",
    sourceProductId: "PID001",
    currentMetric: 3.1,
    baselineMetric: 4.2,
    delta: -1.1,
    threshold: -0.5,
    evidenceReviewIds: ["r1", "r2"],
    confidence: "high",
    ...overrides,
  };
}

function makeResponse(overrides: Partial<EarlyWarningsResponse> = {}): EarlyWarningsResponse {
  return {
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    filters: { platform: null, brand: null },
    productsScanned: 10,
    signals: [makeSignal()],
    ...overrides,
  };
}

function renderWarnings(initialPath = "/warnings") {
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
          <Route path="/warnings" element={<Warnings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Warnings / Early Warnings (Phase 7 Step 5)", () => {
  beforeEach(() => {
    getEarlyWarningsMock.mockReset();
  });

  it("1. renders successfully with real mocked data", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    expect(await screen.findByText("Early Warnings")).toBeInTheDocument();
  });

  it("2. shows the real signal values from the API (current/baseline/delta/threshold)", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.getByText("3.1")).toBeInTheDocument();
    expect(screen.getByText("4.2")).toBeInTheDocument();
    expect(screen.getByText("-1.1")).toBeInTheDocument();
    expect(screen.getByText("-0.5")).toBeInTheDocument();
  });

  it("3. renders all real signal types via SignalBadge labels", async () => {
    getEarlyWarningsMock.mockResolvedValue(
      makeResponse({
        signals: [
          makeSignal({ signalType: "sudden_rating_decline", sourceProductId: "PID001" }),
          makeSignal({ signalType: "sudden_negative_review_increase", sourceProductId: "PID002" }),
          makeSignal({ signalType: "complaint_spike", sourceProductId: "PID003" }),
          makeSignal({ signalType: "review_volume_spike", sourceProductId: "PID004" }),
          makeSignal({ signalType: "persistent_negative_trend", sourceProductId: "PID005" }),
        ],
      }),
    );
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.getAllByText("Rating decline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Negative review increase").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Complaint spike").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Volume spike").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Persistent negative trend").length).toBeGreaterThan(0);
  });

  it("4. renders all real confidence states via ConfidenceBadge labels", async () => {
    getEarlyWarningsMock.mockResolvedValue(
      makeResponse({
        signals: [
          makeSignal({ confidence: "high", sourceProductId: "PID001" }),
          makeSignal({ confidence: "medium", sourceProductId: "PID002" }),
          makeSignal({ confidence: "low", sourceProductId: "PID003" }),
        ],
      }),
    );
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.getAllByText("High confidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Medium confidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Low confidence").length).toBeGreaterThan(0);
  });

  it("5. separates not_ready signals into their own informational panel, never as active warnings", async () => {
    getEarlyWarningsMock.mockResolvedValue(
      makeResponse({
        signals: [
          makeSignal({ confidence: "high", sourceProductId: "PID001" }),
          makeSignal({ signalType: "product_deterioration", confidence: "not_ready", sourceProductId: "PID002" }),
        ],
      }),
    );
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.getByText("Not Available Yet")).toBeInTheDocument();
    expect(screen.queryByText(/PID002/)).not.toBeInTheDocument();
    expect(screen.getByText(/product deterioration/i)).toBeInTheDocument();
  });

  it("6. renders the insufficient_data confidence state honestly, not hidden", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse({ signals: [makeSignal({ confidence: "insufficient_data" })] }));
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
  });

  it("7. shows an honest empty state when there are zero active warnings", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse({ signals: [] }));
    renderWarnings();
    expect(await screen.findByText("No active warnings for this period")).toBeInTheDocument();
  });

  it("8. shows skeleton loading UI before data resolves", async () => {
    getEarlyWarningsMock.mockReturnValue(new Promise(() => {}));
    renderWarnings();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("9. renders the not-permitted state on a real 401/403", async () => {
    getEarlyWarningsMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    renderWarnings();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("10. renders a generic error for a real 500", async () => {
    getEarlyWarningsMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderWarnings();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("11. each active warning links to the exact Product Detail URL", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    const link = await screen.findByText(/PID001/);
    expect(link.closest("a")).toHaveAttribute("href", "/products/flipkart/PID001");
  });

  it("12. changing the window updates the URL and requests the new window", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    await screen.findByText(/PID001/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "90d" }));
    await waitFor(() => {
      expect(getEarlyWarningsMock).toHaveBeenCalledWith(expect.objectContaining({ window: "90d" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("window=90d");
  });

  it("13. platform and brand filters send the exact contract-supported values", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    await screen.findByText(/PID001/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Flipkart" }));
    await waitFor(() => {
      expect(getEarlyWarningsMock).toHaveBeenCalledWith(expect.objectContaining({ platform: "flipkart" }), expect.anything());
    });

    await user.type(screen.getByLabelText(/brand/i), "Bluepeak");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(getEarlyWarningsMock).toHaveBeenCalledWith(expect.objectContaining({ brand: "Bluepeak" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("brand=Bluepeak");
  });

  it("14. never fabricates a severityScore or totalScore anywhere on the page", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.queryByText(/severityScore/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/totalScore/i)).not.toBeInTheDocument();
  });

  it("15. the signal-type filter only groups/counts already-fetched data, no client analytics", async () => {
    getEarlyWarningsMock.mockResolvedValue(
      makeResponse({
        signals: [
          makeSignal({ signalType: "sudden_rating_decline", sourceProductId: "PID001" }),
          makeSignal({ signalType: "sudden_rating_decline", sourceProductId: "PID002" }),
          makeSignal({ signalType: "review_volume_spike", sourceProductId: "PID003" }),
        ],
      }),
    );
    renderWarnings();
    await screen.findByText(/PID001/);
    expect(screen.getByRole("tab", { name: "All (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "sudden rating decline (2)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "review volume spike (1)" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "review volume spike (1)" }));
    await waitFor(() => {
      expect(screen.queryByText(/PID001/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/PID003/)).toBeInTheDocument();
    // Purely presentational client-side filtering — no new API call.
    expect(getEarlyWarningsMock).toHaveBeenCalledTimes(1);
  });

  it("16. only sends the exact real contract query parameters — no invented filter fields", async () => {
    getEarlyWarningsMock.mockResolvedValue(makeResponse());
    renderWarnings();
    await screen.findByText(/PID001/);
    const call = getEarlyWarningsMock.mock.calls[0]![0];
    expect(Object.keys(call).sort()).toEqual(["brand", "platform", "window"].sort());
  });

  // Phase 8 Step 4 — UX transformation tests
  describe("Phase 8 Step 4 — Premium investigation UX", () => {
    it("17. displays Active Signals section with count badge when signals exist", async () => {
      getEarlyWarningsMock.mockResolvedValue(
        makeResponse({
          signals: [
            makeSignal({ sourceProductId: "PID001" }),
            makeSignal({ sourceProductId: "PID002" }),
            makeSignal({ sourceProductId: "PID003" }),
          ],
        }),
      );
      renderWarnings();
      await screen.findByText(/PID001/);
      expect(screen.getByText("Active Signals")).toBeInTheDocument();
      expect(screen.getByText("3 signals detected")).toBeInTheDocument();
    });

    it("18. displays Filters as a labeled section landmark", async () => {
      getEarlyWarningsMock.mockResolvedValue(makeResponse());
      renderWarnings();
      await screen.findByText(/PID001/);
      expect(screen.getByText("Filters")).toBeInTheDocument();
      const filtersSection = screen.getByLabelText(/Filters/);
      expect(filtersSection).toBeInTheDocument();
    });

    it("19. displays Not Available Yet as a section with improved visual hierarchy", async () => {
      getEarlyWarningsMock.mockResolvedValue(
        makeResponse({
          signals: [
            makeSignal({ confidence: "high", sourceProductId: "PID001" }),
            makeSignal({ signalType: "product_deterioration", confidence: "not_ready", sourceProductId: "PID002" }),
            makeSignal({ signalType: "product_deterioration", confidence: "not_ready", sourceProductId: "PID003" }),
          ],
        }),
      );
      renderWarnings();
      await screen.findByText(/PID001/);
      expect(screen.getByText("Not Available Yet")).toBeInTheDocument();
      expect(screen.getByText(/not currently available/)).toBeInTheDocument();
    });

    it("20. provides proper section landmarks for accessibility (aria-labelledby)", async () => {
      getEarlyWarningsMock.mockResolvedValue(makeResponse());
      renderWarnings();
      await screen.findByText(/PID001/);
      const activeSignalsSection = screen.getByLabelText(/Active Signals/);
      expect(activeSignalsSection).toBeInTheDocument();
    });

    it("21. shows signal-type filter label only when signals exist", async () => {
      getEarlyWarningsMock.mockResolvedValue(makeResponse({ signals: [] }));
      renderWarnings();
      await screen.findByText("No active warnings for this period");
      expect(screen.queryByText("Filter by signal type:")).not.toBeInTheDocument();
    });

    it("22. shows signal-type filter label when active signals exist", async () => {
      getEarlyWarningsMock.mockResolvedValue(
        makeResponse({
          signals: [makeSignal({ sourceProductId: "PID001" })],
        }),
      );
      renderWarnings();
      await screen.findByText(/PID001/);
      expect(screen.getByText("Filter by signal type:")).toBeInTheDocument();
    });

    it("23. maintains the count badge as singular when there is exactly one signal", async () => {
      getEarlyWarningsMock.mockResolvedValue(
        makeResponse({
          signals: [makeSignal({ sourceProductId: "PID001" })],
        }),
      );
      renderWarnings();
      await screen.findByText(/PID001/);
      expect(screen.getByText("1 signal detected")).toBeInTheDocument();
    });

    it("24. preserves all real signal and confidence data even with improved layout", async () => {
      getEarlyWarningsMock.mockResolvedValue(
        makeResponse({
          signals: [
            makeSignal({
              signalType: "sudden_rating_decline",
              platform: "flipkart",
              sourceProductId: "PID001",
              currentMetric: 2.5,
              baselineMetric: 4.0,
              delta: -1.5,
              threshold: -0.8,
              confidence: "high",
            }),
          ],
        }),
      );
      renderWarnings();
      await screen.findByText(/PID001/);
      expect(screen.getByText("2.5")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
      expect(screen.getByText("-1.5")).toBeInTheDocument();
      expect(screen.getByText("-0.8")).toBeInTheDocument();
      expect(screen.getByText("High confidence")).toBeInTheDocument();
    });
  });
});
