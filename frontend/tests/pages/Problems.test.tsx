import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { Problems } from "@/pages/Problems";
import { ApiClientError } from "@/api/errors";
import type { ProblemsResponse, ProblemThemeSummary } from "@/types/api";

const { getProblemsMock } = vi.hoisted(() => ({ getProblemsMock: vi.fn() }));
vi.mock("@/api/endpoints/problems", () => ({ getProblems: getProblemsMock }));

function makeTheme(overrides: Partial<ProblemThemeSummary> = {}): ProblemThemeSummary {
  return {
    theme: "quality",
    mentionCount: 42,
    distinctReviewCount: 30,
    distinctProductCount: 12,
    confidence: "high",
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ProblemsResponse> = {}): ProblemsResponse {
  return {
    window: { start: "2026-01-01", end: "2026-01-30" },
    cacheHit: false,
    filters: { platform: null, theme: null },
    themes: [makeTheme()],
    ...overrides,
  };
}

function renderProblems(initialPath = "/problems") {
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
          <Route path="/problems" element={<Problems />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The theme filter tab strip always renders all THEME_VOCABULARY labels
// (e.g. "quality") regardless of load state, so waiting on that text is a
// false proxy for "the query resolved" — the same class of bug flagged in
// earlier Phase 7 steps, different cause (static filter option vs. a split
// text node). Every wait here targets a table *cell* instead, which only
// exists once the real data has rendered.
async function findThemeCell(name: string) {
  return screen.findByRole("cell", { name });
}

describe("Problems (Phase 7 Step 6)", () => {
  beforeEach(() => {
    getProblemsMock.mockReset();
  });

  it("1. renders successfully with real mocked data", async () => {
    getProblemsMock.mockResolvedValue(makeResponse());
    renderProblems();
    expect(await screen.findByText("Problems")).toBeInTheDocument();
  });

  it("2. shows the exact backend-returned theme value", async () => {
    getProblemsMock.mockResolvedValue(makeResponse({ themes: [makeTheme({ theme: "product_mismatch" })] }));
    renderProblems();
    expect(await findThemeCell("product mismatch")).toBeInTheDocument();
  });

  it("3. shows the exact backend-returned counts (mentions/reviews/products) and confidence", async () => {
    getProblemsMock.mockResolvedValue(
      makeResponse({ themes: [makeTheme({ mentionCount: 77, distinctReviewCount: 55, distinctProductCount: 20, confidence: "medium" })] }),
    );
    renderProblems();
    const row = (await findThemeCell("quality")).closest("tr")!;
    expect(within(row).getByText("77")).toBeInTheDocument();
    expect(within(row).getByText("55")).toBeInTheDocument();
    expect(within(row).getByText("20")).toBeInTheDocument();
    expect(within(row).getByText("Medium confidence")).toBeInTheDocument();
  });

  it("4. preserves the exact order the backend returned, never re-sorted client-side", async () => {
    getProblemsMock.mockResolvedValue(
      makeResponse({
        themes: [
          makeTheme({ theme: "size", mentionCount: 5 }),
          makeTheme({ theme: "quality", mentionCount: 90 }),
          makeTheme({ theme: "fit", mentionCount: 40 }),
        ],
      }),
    );
    renderProblems();
    await findThemeCell("size");
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1); // skip header row
    const themeCells = rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(themeCells).toEqual(["size", "quality", "fit"]);
  });

  it("5. shows skeleton loading UI before data resolves", async () => {
    getProblemsMock.mockReturnValue(new Promise(() => {}));
    renderProblems();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("6. shows an honest empty state when there are zero themes", async () => {
    getProblemsMock.mockResolvedValue(makeResponse({ themes: [] }));
    renderProblems();
    expect(await screen.findByText("No recurring problems found for this period")).toBeInTheDocument();
  });

  it("7. renders the session-expired state on a real 401", async () => {
    getProblemsMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    renderProblems();
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });

  it("8. renders the not-permitted state on a real 403", async () => {
    getProblemsMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    renderProblems();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("9. renders a generic error for a real 500/network failure", async () => {
    getProblemsMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderProblems();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("10. retry re-issues the request after a failure", async () => {
    getProblemsMock.mockRejectedValueOnce(new ApiClientError("server", "boom"));
    getProblemsMock.mockResolvedValueOnce(makeResponse());
    renderProblems();
    await screen.findByText("Something went wrong");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await findThemeCell("quality");
    expect(getProblemsMock).toHaveBeenCalledTimes(2);
  });

  it("11. handles the response's nullable filters echo without fabricating a value", async () => {
    getProblemsMock.mockResolvedValue(makeResponse({ filters: { platform: null, theme: null } }));
    renderProblems();
    await findThemeCell("quality");
    // No platform/theme label is ever rendered as a fabricated non-null
    // value when the backend echoed null for an unset filter.
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("12. renders insufficient_data confidence honestly, never hidden", async () => {
    getProblemsMock.mockResolvedValue(makeResponse({ themes: [makeTheme({ confidence: "insufficient_data" })] }));
    renderProblems();
    const row = (await findThemeCell("quality")).closest("tr")!;
    expect(within(row).getByText("Not enough data")).toBeInTheDocument();
  });

  it("13. never renders a product drill-down link — the contract provides no product identifiers", async () => {
    getProblemsMock.mockResolvedValue(makeResponse());
    renderProblems();
    await findThemeCell("quality");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("14. window/platform/theme filters round-trip through the URL and request the new values", async () => {
    getProblemsMock.mockResolvedValue(makeResponse());
    renderProblems();
    await findThemeCell("quality");
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "90d" }));
    await waitFor(() => {
      expect(getProblemsMock).toHaveBeenCalledWith(expect.objectContaining({ window: "90d" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("window=90d");

    await user.click(screen.getByRole("tab", { name: "Flipkart" }));
    await waitFor(() => {
      expect(getProblemsMock).toHaveBeenCalledWith(expect.objectContaining({ platform: "flipkart" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("platform=flipkart");

    const themeTabs = screen.getByRole("tablist", { name: "Theme filter" });
    await user.click(within(themeTabs).getByRole("tab", { name: "durability" }));
    await waitFor(() => {
      expect(getProblemsMock).toHaveBeenCalledWith(expect.objectContaining({ theme: "durability" }), expect.anything());
    });
    expect(screen.getByTestId("location-search").textContent).toContain("theme=durability");
  });

  it("15. never fabricates a severity value or label anywhere on the page", async () => {
    getProblemsMock.mockResolvedValue(makeResponse());
    renderProblems();
    await findThemeCell("quality");
    expect(screen.queryByText(/severity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/critical|high priority|low priority/i)).not.toBeInTheDocument();
  });

  it("16. performs no client-side analytics — displayed numbers are exactly the backend's, one API call per load", async () => {
    getProblemsMock.mockResolvedValue(makeResponse({ themes: [makeTheme({ mentionCount: 13, distinctReviewCount: 9, distinctProductCount: 4 })] }));
    renderProblems();
    const row = (await findThemeCell("quality")).closest("tr")!;
    expect(within(row).getByText("13")).toBeInTheDocument();
    expect(within(row).getByText("9")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(getProblemsMock).toHaveBeenCalledTimes(1);
  });

  it("17. only sends the exact real contract query parameters — no invented fields", async () => {
    getProblemsMock.mockResolvedValue(makeResponse());
    renderProblems();
    await findThemeCell("quality");
    const call = getProblemsMock.mock.calls[0]![0];
    expect(Object.keys(call).sort()).toEqual(["platform", "theme", "window"].sort());
  });

  it("18. respects window/platform/theme from the initial URL on mount", async () => {
    getProblemsMock.mockResolvedValue(makeResponse());
    renderProblems("/problems?window=60d&platform=myntra&theme=fit");
    await waitFor(() => {
      expect(getProblemsMock).toHaveBeenCalledWith(expect.objectContaining({ window: "60d", platform: "myntra", theme: "fit" }), expect.anything());
    });
  });

  // Phase 8 Step 5 — UX transformation tests
  describe("Phase 8 Step 5 — Premium investigation UX", () => {
    it("19. displays Problem Themes section with theme count badge when results exist", async () => {
      getProblemsMock.mockResolvedValue(
        makeResponse({
          themes: [
            makeTheme({ theme: "quality" }),
            makeTheme({ theme: "size" }),
            makeTheme({ theme: "fit" }),
          ],
        }),
      );
      renderProblems();
      await findThemeCell("quality");
      expect(screen.getByText("Problem Themes")).toBeInTheDocument();
      expect(screen.getByText("3 themes found")).toBeInTheDocument();
    });

    it("20. displays Filters as a labeled section landmark", async () => {
      getProblemsMock.mockResolvedValue(makeResponse());
      renderProblems();
      await findThemeCell("quality");
      expect(screen.getByText("Filters")).toBeInTheDocument();
      const filtersSection = screen.getByLabelText(/Filters/);
      expect(filtersSection).toBeInTheDocument();
    });

    it("21. displays Next Steps section with capability boundary messaging", async () => {
      getProblemsMock.mockResolvedValue(makeResponse());
      renderProblems();
      await findThemeCell("quality");
      expect(screen.getByText("Next Steps")).toBeInTheDocument();
      expect(screen.getByText(/Product-level investigation not available/i)).toBeInTheDocument();
    });

    it("22. provides proper section landmarks for accessibility (aria-labelledby)", async () => {
      getProblemsMock.mockResolvedValue(makeResponse());
      renderProblems();
      await findThemeCell("quality");
      const problemsSection = screen.getByLabelText(/Problem Themes/);
      expect(problemsSection).toBeInTheDocument();
    });

    it("23. uses singular 'theme' in count badge when there is exactly one theme", async () => {
      getProblemsMock.mockResolvedValue(
        makeResponse({
          themes: [makeTheme({ theme: "quality" })],
        }),
      );
      renderProblems();
      await findThemeCell("quality");
      expect(screen.getByText("1 theme found")).toBeInTheDocument();
    });

    it("24. preserves all real theme data even with improved layout", async () => {
      getProblemsMock.mockResolvedValue(
        makeResponse({
          themes: [
            makeTheme({
              theme: "quality",
              mentionCount: 55,
              distinctReviewCount: 44,
              distinctProductCount: 33,
              confidence: "medium",
            }),
          ],
        }),
      );
      renderProblems();
      const row = (await findThemeCell("quality")).closest("tr")!;
      expect(within(row).getByText("55")).toBeInTheDocument();
      expect(within(row).getByText("44")).toBeInTheDocument();
      expect(within(row).getByText("33")).toBeInTheDocument();
      expect(within(row).getByText("Medium confidence")).toBeInTheDocument();
    });
  });
});
