import { useState, useEffect, memo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, BarChart3, Loader, Eye, Sparkles } from "lucide-react";
import { getReviewsOverview, type ReviewsOverviewResponse } from "@/api/endpoints/reviews";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useWebSocketEvent } from "@/hooks/useWebSocket";

// Memoized row component to prevent unnecessary re-renders
interface ProductRowProps {
  product: any;
  type: string;
  loading: boolean;
  onProductClick: (id: string) => void;
  onAIAnalystClick: (id: string) => void;
}

const ProductRowMemo = memo(function ProductRow({ product, type, loading, onProductClick, onAIAnalystClick }: ProductRowProps) {
  const displayPercent = type === "negative"
    ? Math.round((product.negativeCount / product.totalInLatestTen) * 100)
    : Math.round((product.positiveCount / product.totalInLatestTen) * 100);

  const ratingValue = typeof product.averageRating === 'number'
    ? product.averageRating
    : parseFloat(String(product.averageRating)) || 0;

  return (
    <TableRow key={product.sourceProductId} className="hover:bg-slate-800/50">
      <TableCell className="font-bold text-purple-300">#{product.rank}</TableCell>
      <TableCell className="font-mono text-sm">{product.sourceProductId}</TableCell>
      <TableCell className="font-semibold text-blue-300">{product.brand}</TableCell>
      <TableCell className="capitalize">{product.platform}</TableCell>
      <TableCell className="text-right">{ratingValue.toFixed(1)}</TableCell>
      <TableCell className="text-right font-semibold">{displayPercent}%</TableCell>
      <TableCell className="text-right">{product.totalInLatestTen}</TableCell>
      <TableCell className="text-center">
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => onProductClick(product.sourceProductId)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-3 rounded text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-muted"
            title="View detailed product information"
          >
            <Eye className="size-4" />
            View Details
          </button>
          <button
            onClick={() => onAIAnalystClick(product.sourceProductId)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-3 rounded text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-violet-600"
            title="Open AI Analyst dashboard for this product"
          >
            <Sparkles className="size-4" />
            AI Dashboard
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
});

interface CustomDateRangeInputProps {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

const CustomDateRangeInput = memo(function CustomDateRange({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onApply,
  onCancel,
}: CustomDateRangeInputProps) {
  return (
    <div className="mt-6 pt-6 border-t border-slate-600">
      <div className="space-y-4">
        <p className="text-sm font-bold text-gray-200 uppercase tracking-wide">📆 Custom Date Range</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-300 block mb-2">
              From Date {fromDate && <span className="text-purple-300">✓ {fromDate}</span>}
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => onFromDateChange(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white border-2 border-slate-600 hover:border-purple-500 focus:border-purple-500 outline-none transition-colors cursor-pointer"
              style={{
                colorScheme: "dark"
              }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-300 block mb-2">
              To Date {toDate && <span className="text-purple-300">✓ {toDate}</span>}
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => onToDateChange(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white border-2 border-slate-600 hover:border-purple-500 focus:border-purple-500 outline-none transition-colors cursor-pointer"
              style={{
                colorScheme: "dark"
              }}
            />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onApply}
            className="flex-1 px-6 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold transition-all"
          >
            ✓ Apply Date Range
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-3 rounded-lg bg-slate-600/50 hover:bg-slate-600 text-gray-300 font-medium transition-colors"
            title="Clear custom date range"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
});

interface ReviewWindowState {
  windowType: "latest10" | "latest20" | "latest50" | "latest100" | "custom";
  customFromDate?: string;
  customToDate?: string;
}

interface ListState {
  data: ReviewsOverviewResponse | null;
  loading: boolean;
  error: string | null;
  page: number;
  showData: boolean;
}


export function ProductRankingList() {
  const navigate = useNavigate();
  const { platform, type } = useParams<{ platform: string; type: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read page from URL, default to 0 (zero-based internally)
  const pageFromUrl = parseInt(searchParams.get("page") || "0", 10);
  const currentPage = Math.max(0, isNaN(pageFromUrl) ? 0 : pageFromUrl);

  // Review window state
  const [reviewWindow, setReviewWindow] = useState<ReviewWindowState>({
    windowType: "latest10",
  });
  const [customDateInputs, setCustomDateInputs] = useState({ fromDate: "", toDate: "" });
  const [sortBy, setSortBy] = useState<"default" | "ratingAsc" | "ratingDesc">("default");

  // Cache key for this ranking - includes review window and sort order to prevent stale data collisions
  const cacheKey = `ranking-${platform}-${type}-${currentPage}-${reviewWindow.windowType}${
    reviewWindow.windowType === "custom"
      ? `-${reviewWindow.customFromDate}-${reviewWindow.customToDate}`
      : ""
  }-${sortBy}`;

  // Get cached data if available and fresh (30 second TTL for auto-refresh with new data)
  const getCachedData = () => {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 30 * 1000) {
          return parsed.data;
        }
      }
    } catch (e) {
      // Silently ignore cache errors
    }
    return null;
  };

  const cachedData = getCachedData();

  const [state, setState] = useState<ListState>({
    data: cachedData || null,
    loading: !cachedData,
    error: null,
    page: currentPage,
    showData: !!cachedData,
  });

  // ✅ CRITICAL FIX: When currentPage changes, always invalidate old page's cached data
  // This ensures fresh data fetches when user clicks pagination buttons
  useEffect(() => {
    // Don't show stale cached data from different page
    if (state.data && state.page !== currentPage) {
      setState(prev => ({ ...prev, data: null, loading: true, page: currentPage, showData: false }));
    }
  }, [currentPage, state.page, state.data]);

  useEffect(() => {
    // Validate params inline to avoid dependency array issues
    const isValidPlatform = platform === "flipkart" || platform === "myntra";
    const isValidType = type === "negative" || type === "positive";

    if (!isValidPlatform || !isValidType) {
      navigate("/reviews-overview");
      return;
    }

    // Only fetch if state.loading is true (cache invalidation set it)
    if (!state.loading) {
      return;
    }

    // Track if component is mounted (prevents setState after unmount)
    let isMounted = true;

    // Fetch with mounted check
    const performFetch = async () => {
      try {
        if (!isMounted) return;

        console.log("[🔄 FetchStart] reviewWindow state:", {
          windowType: reviewWindow.windowType,
          customFromDate: reviewWindow.customFromDate,
          customToDate: reviewWindow.customToDate,
          platform,
          type,
          page: currentPage,
        });

        const result = await getReviewsOverview({
          platform: platform as "flipkart" | "myntra",
          type: type as "negative" | "positive",
          page: currentPage,
          reviewWindow: reviewWindow.windowType,
          customFromDate: reviewWindow.customFromDate,
          customToDate: reviewWindow.customToDate,
          sortBy: sortBy === "default" ? undefined : sortBy,
        });

        console.log("[✅ FetchSuccess] API returned data:", {
          productCount: result.products.length,
          totalProducts: result.pagination.total,
          platform,
          type,
        });

        if (isMounted) {
          setState((prev) => ({ ...prev, data: result, loading: false }));

          // ✅ Cache the result for next navigation
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
              data: result,
              timestamp: Date.now(),
            }));
          } catch (e) {
            // Silently ignore storage errors (quota exceeded, etc)
          }
        }
      } catch (err) {
        if (isMounted) {
          let errorMessage = "Error loading data";

          // Check if it's an error with structured message
          if (err instanceof Error) {
            errorMessage = err.message;

            // Log full error for debugging
            console.error("[ProductRankingList] Fetch error details:", {
              name: err.name,
              message: err.message,
              stack: err.stack,
              fullError: err,
            });
          }

          console.error("[ProductRankingList] Fetch error:", err);
          setState((prev) => ({
            ...prev,
            error: errorMessage,
            loading: false,
          }));
        }
      }
    };

    performFetch();

    // Cleanup: mark as unmounted
    return () => {
      isMounted = false;
    };
  }, [platform, type, currentPage, navigate, state.loading, reviewWindow, sortBy]);

  // ✅ RENDER IMMEDIATELY: Show data as soon as API returns
  // The skeleton feedback + fade animation masks any render jank
  useEffect(() => {
    if (state.data && !state.loading && !state.showData) {
      setState((prev) => ({ ...prev, showData: true }));
    }
  }, [state.data, state.loading, state.showData]);

  // Save scroll position before navigating away (10/10 UX)
  const saveScrollPosition = () => {
    try {
      const scrollPos = window.scrollY;
      sessionStorage.setItem(`ranking-scroll-${platform}-${type}-${currentPage}`, scrollPos.toString());
    } catch (e) {
      // Silently ignore
    }
  };

  // Restore scroll position on mount (10/10 UX)
  useEffect(() => {
    if (state.data && !state.loading) {
      try {
        const saved = sessionStorage.getItem(`ranking-scroll-${platform}-${type}-${currentPage}`);
        if (saved) {
          const scrollPos = parseInt(saved, 10);
          setTimeout(() => window.scrollTo(0, scrollPos), 100); // ✅ Smooth restore
        }
      } catch (e) {
        // Silently ignore
      }
    }
  }, [state.data, state.loading, platform, type, currentPage]);

  /**
   * Listen for post-commit ingestion events.
   *
   * Deliberately does NOT require the updated product to already be on the
   * current page. A source replacement swaps the whole dataset, so the products
   * that need showing are precisely the ones absent from the stale list — an
   * earlier version returned early on `productIndex === -1`, which meant a
   * replacement produced no refresh at all and the UI kept serving ghosts.
   *
   * Every ranking cache entry for the platform is dropped (not just this page's
   * key) because ranks, pagination and averages all shift when the dataset does.
   */
  useWebSocketEvent("PRODUCT_DATA_UPDATED", (event) => {
    if (!platform || !type) return;
    if (event.platform !== platform) return;

    try {
      const keysToDelete: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(`ranking-${platform}-`)) keysToDelete.push(key);
      }
      keysToDelete.forEach((key) => sessionStorage.removeItem(key));
    } catch {
      // sessionStorage unavailable — the refetch below still corrects the view.
    }

    void refreshCurrentView();
  });

  /**
   * Resync after the socket comes back.
   *
   * Events emitted while this tab was disconnected are gone — a WebSocket has no
   * replay — so reconnecting is the only signal that data may have moved on
   * without us. Without this the database can be fully up to date while the tab
   * shows stale rows indefinitely.
   */
  useWebSocketEvent("CONNECTION_RESTORED", () => {
    if (!platform || !type) return;
    try {
      const keysToDelete: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(`ranking-${platform}-`)) keysToDelete.push(key);
      }
      keysToDelete.forEach((key) => sessionStorage.removeItem(key));
    } catch {
      /* the refetch below still corrects the view */
    }
    void refreshCurrentView();
  });

  // Refetch the current view in place. No page reload, and pagination /
  // filter / sort state is preserved because the same params are reused.
  function refreshCurrentView() {
    const performRefresh = async () => {
      try {
        const result = await getReviewsOverview({
          platform: platform as "flipkart" | "myntra",
          type: type as "negative" | "positive",
          page: currentPage,
          reviewWindow: reviewWindow.windowType,
          customFromDate: reviewWindow.customFromDate,
          customToDate: reviewWindow.customToDate,
          sortBy: sortBy === "default" ? undefined : sortBy,
        });
        setState((prev) => ({ ...prev, data: result, loading: false, showData: true }));

        // Update cache with fresh data
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            data: result,
            timestamp: Date.now(),
          }));
        } catch (e) {
          // Silently ignore storage errors
        }
      } catch (err) {
        console.error("[ProductRankingList] Failed to refresh data:", err);
      }
    };

    performRefresh();
  }

  const handleProductClick = (sourceProductId: string) => {
    saveScrollPosition(); // ✅ Save before navigation
    navigate(
      `/products/${platform}/${sourceProductId}?from=ranking&platform=${platform}&type=${type}&page=${currentPage}`,
    );
  };

  const handleAIAnalystClick = (sourceProductId: string) => {
    saveScrollPosition(); // ✅ Save before navigation
    navigate(
      `/ai/analyst?platform=${platform}&productId=${sourceProductId}&from=ranking&type=${type}&page=${currentPage}`,
    );
  };

  const platformLabel = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Unknown";
  const typeLabel = type === "negative" ? "Most Bad Reviews" : "Most Good Reviews";
  const typeIcon = type === "negative" ? "📉" : "📈";

  // Helper functions for filter management
  const resetAllFilters = () => {
    setReviewWindow({ windowType: "latest10" });
    setCustomDateInputs({ fromDate: "", toDate: "" });
    setSortBy("default");
    setSearchParams({ page: "0" });
    setState(prev => ({ ...prev, data: null, loading: true }));
  };

  const resetReviewWindow = () => {
    setReviewWindow({ windowType: "latest10" });
    setCustomDateInputs({ fromDate: "", toDate: "" });
    setSearchParams({ page: "0" });
    setState(prev => ({ ...prev, data: null, loading: true }));
  };

  const resetSort = () => {
    setSortBy("default");
    setSearchParams({ page: "0" });
    setState(prev => ({ ...prev, data: null, loading: true }));
  };

  // Check if any filters are active
  const hasActiveFilters = reviewWindow.windowType !== "latest10" || sortBy !== "default";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Back button */}
        <button
          onClick={() => navigate(`/reviews-overview/${platform}`)}
          className="flex items-center gap-2 text-purple-300 hover:text-purple-200 mb-12 font-semibold transition-colors group"
        >
          <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span>Back to {platformLabel} Reviews</span>
        </button>

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <span className="text-5xl">{typeIcon}</span>
            <div>
              <h1 className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                {platformLabel} — {typeLabel}
              </h1>
              <p className="text-gray-400 mt-2">
                Ranked by {type} sentiment • 100 products per page
              </p>
            </div>
          </div>
        </div>

        {/* OPTIMIZED COMPACT FILTER PANEL */}
        <div className="mb-6 bg-slate-800/40 border border-slate-700 rounded-lg p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-white">🔍 Filters</span>
              {hasActiveFilters && (
                <span className="px-3 py-1 bg-purple-600/40 text-purple-200 text-sm rounded-full font-medium">
                  {reviewWindow.windowType !== "latest10" ? "1" : "0"} + {sortBy !== "default" ? "1" : "0"} active
                </span>
              )}
            </div>
            {hasActiveFilters && (
              <button
                onClick={resetAllFilters}
                className="px-4 py-2 rounded-lg bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-600/50 transition-colors font-medium text-sm"
                title="Clear all filters and reset to defaults"
              >
                ✕ Clear All
              </button>
            )}
          </div>

          {/* Filter Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Review Window Filter */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-gray-200 uppercase tracking-wide">📅 Review Window</label>
                {reviewWindow.windowType !== "latest10" && (
                  <button
                    onClick={resetReviewWindow}
                    className="text-xs px-2 py-1 rounded bg-slate-600/50 text-gray-300 hover:bg-slate-600 transition-colors"
                    title="Reset to Latest 10 Reviews"
                  >
                    Reset
                  </button>
                )}
              </div>
              <select
                value={reviewWindow.windowType}
                onChange={(e) => {
                  const newWindowType = e.target.value as ReviewWindowState["windowType"];

                  // If switching to custom, don't auto-fetch yet - wait for Apply button
                  if (newWindowType === "custom") {
                    setReviewWindow({ windowType: "custom" });
                    return;
                  }

                  // For other window types, fetch immediately
                  const newWindow: ReviewWindowState = { windowType: newWindowType };
                  setReviewWindow(newWindow);
                  setSearchParams({ page: "0" });
                  setState(prev => ({ ...prev, data: null, loading: true }));
                }}
                className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white border-2 border-slate-600 hover:border-purple-500 focus:border-purple-500 outline-none transition-colors font-medium"
              >
                <option value="latest10">📊 Latest 10 Reviews</option>
                <option value="latest20">📊 Latest 20 Reviews</option>
                <option value="latest50">📊 Latest 50 Reviews</option>
                <option value="latest100">📊 Latest 100 Reviews</option>
                <option value="custom">📆 Custom Date Range</option>
              </select>
              {reviewWindow.windowType === "latest10" && (
                <p className="text-xs text-gray-400">✓ Default setting</p>
              )}
            </div>

            {/* Sort Filter */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-gray-200 uppercase tracking-wide">⬆️ Sort By Rating</label>
                {sortBy !== "default" && (
                  <button
                    onClick={resetSort}
                    className="text-xs px-2 py-1 rounded bg-slate-600/50 text-gray-300 hover:bg-slate-600 transition-colors"
                    title="Reset to Default Sort"
                  >
                    Reset
                  </button>
                )}
              </div>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as "default" | "ratingAsc" | "ratingDesc");
                  setSearchParams({ page: "0" });
                  setState(prev => ({ ...prev, data: null, loading: true }));
                }}
                className="w-full px-4 py-3 rounded-lg bg-slate-700 text-white border-2 border-slate-600 hover:border-purple-500 focus:border-purple-500 outline-none transition-colors font-medium"
              >
                <option value="default">Natural Ranking (No Sort)</option>
                <option value="ratingAsc">↑ Ascending (Low to High)</option>
                <option value="ratingDesc">↓ Descending (High to Low)</option>
              </select>
              {sortBy === "default" && (
                <p className="text-xs text-gray-400">
                  ✓ {type === "negative" ? "Worst First" : "Best First"}
                </p>
              )}
            </div>
          </div>

          {/* Custom Date Range Section */}
          {reviewWindow.windowType === "custom" && (
            <CustomDateRangeInput
              fromDate={customDateInputs.fromDate}
              toDate={customDateInputs.toDate}
              onFromDateChange={(val) => setCustomDateInputs(prev => ({ ...prev, fromDate: val }))}
              onToDateChange={(val) => setCustomDateInputs(prev => ({ ...prev, toDate: val }))}
              onApply={async () => {
                const fromDate = customDateInputs.fromDate;
                const toDate = customDateInputs.toDate;

                try {
                  const result = await getReviewsOverview({
                    platform: platform as "flipkart" | "myntra",
                    type: type as "negative" | "positive",
                    page: 0,
                    reviewWindow: "custom",
                    customFromDate: fromDate,
                    customToDate: toDate,
                    sortBy: sortBy === "default" ? undefined : sortBy,
                  });

                  setState(prev => ({
                    ...prev,
                    data: result,
                    loading: false,
                    showData: true,
                    error: null,
                  }));

                  setReviewWindow({
                    windowType: "custom",
                    customFromDate: fromDate,
                    customToDate: toDate,
                  });

                  setSearchParams({ page: "0" });
                } catch (err) {
                  setState(prev => ({
                    ...prev,
                    error: err instanceof Error ? err.message : "Error loading data",
                    loading: false,
                  }));
                }
              }}
              onCancel={() => {
                setCustomDateInputs({ fromDate: "", toDate: "" });
                resetReviewWindow();
              }}
            />
          )}

          {/* Active Filters Summary */}
          {hasActiveFilters && (
            <div className="mt-6 pt-6 border-t border-slate-600">
              <p className="text-xs font-bold text-gray-300 uppercase mb-3">Active Filters</p>
              <div className="flex flex-wrap gap-2">
                {reviewWindow.windowType !== "latest10" && (
                  <div className="px-3 py-1 rounded-full bg-purple-600/40 text-purple-200 text-sm flex items-center gap-2 border border-purple-600/50">
                    <span>
                      {reviewWindow.windowType === "custom"
                        ? `📆 ${reviewWindow.customFromDate || "?"} to ${reviewWindow.customToDate || "?"}`
                        : `📊 Latest ${reviewWindow.windowType.replace("latest", "")}`}
                    </span>
                    <button
                      onClick={resetReviewWindow}
                      className="ml-1 hover:text-purple-100 transition-colors"
                      title="Remove this filter"
                    >
                      ✕
                    </button>
                  </div>
                )}
                {sortBy !== "default" && (
                  <div className="px-3 py-1 rounded-full bg-blue-600/40 text-blue-200 text-sm flex items-center gap-2 border border-blue-600/50">
                    <span>
                      {sortBy === "ratingAsc" ? "↑ Ascending" : "↓ Descending"}
                    </span>
                    <button
                      onClick={resetSort}
                      className="ml-1 hover:text-blue-100 transition-colors"
                      title="Remove this filter"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error State */}
        {state.error && (
          <div className="mb-8 p-5 bg-red-500/20 border border-red-500/50 rounded-xl">
            <p className="text-red-300 font-semibold">⚠️ {state.error}</p>
          </div>
        )}

        {/* Loading State */}
                {/* Show skeleton while loading (smooth UX) */}
        {state.loading && (
          <Table className="mb-12 opacity-50 transition-opacity duration-300">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Product ID</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Marketplace</TableHead>
                <TableHead className="text-right">Avg Rating</TableHead>
                <TableHead className="text-right">{type === "negative" ? "Negative %" : "Positive %"}</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array(10).fill(0).map((_, i) => (
                <TableRow key={`skeleton-${i}`} className="animate-pulse">
                  <TableCell><div className="h-4 bg-slate-700 rounded w-8"></div></TableCell>
                  <TableCell><div className="h-4 bg-slate-700 rounded w-24"></div></TableCell>
                  <TableCell><div className="h-4 bg-slate-700 rounded w-20"></div></TableCell>
                  <TableCell><div className="h-4 bg-slate-700 rounded w-16"></div></TableCell>
                  <TableCell className="text-right"><div className="h-4 bg-slate-700 rounded w-12 ml-auto"></div></TableCell>
                  <TableCell className="text-right"><div className="h-4 bg-slate-700 rounded w-12 ml-auto"></div></TableCell>
                  <TableCell className="text-right"><div className="h-4 bg-slate-700 rounded w-8 ml-auto"></div></TableCell>
                  <TableCell className="text-center"><div className="h-8 bg-slate-700 rounded w-24 mx-auto"></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Show full spinner only on initial load (never, because skeleton shows) */}
        {false && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader className="w-12 h-12 text-purple-400 animate-spin mb-4" />
            <p className="text-gray-400 text-lg">Loading products...</p>
          </div>
        )}

        {/* Products Table */}
        {state.data && !state.loading && state.showData && (
          <>
            {state.data.products.length > 0 ? (
              <Table className="mb-12 animate-in fade-in duration-500" style={{ contain: 'layout style paint' }}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Product ID</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Marketplace</TableHead>
                    <TableHead className="text-right">Avg Rating</TableHead>
                    <TableHead className="text-right">{type === "negative" ? "Negative %" : "Positive %"}</TableHead>
                    <TableHead className="text-right">Reviews</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody style={{ contain: 'content' }}>
                  {state.data.products.map((product) => (
                    <ProductRowMemo
                      key={product.sourceProductId}
                      product={product}
                      type={type || 'positive'}
                      loading={state.loading}
                      onProductClick={handleProductClick}
                      onAIAnalystClick={handleAIAnalystClick}
                    />
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-20 mb-12">
                <BarChart3 className="w-16 h-16 text-gray-500 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400 text-lg">No products found</p>
              </div>
            )}

            {/* Pagination */}
            {state.data.pagination.totalPages > 1 && (
              <div className="flex justify-between items-center py-8 border-t border-slate-700 mt-8">
                <button
                  className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-white font-semibold hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                  disabled={currentPage === 0}
                  onClick={() => {
                    // ✅ Scroll to top smoothly for better pagination UX
                    window.scrollTo(0, 0);
                    const newPage = Math.max(0, currentPage - 1);
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.set("page", String(newPage));
                    setSearchParams(nextParams, { replace: true });
                  }}
                >
                  ← Previous
                </button>
                <span className="text-gray-300 font-semibold text-lg">
                  Page <span className="text-purple-400">{currentPage + 1}</span> of{" "}
                  <span className="text-purple-400">{state.data.pagination.totalPages}</span> •{" "}
                  <span className="text-purple-300">{state.data.pagination.total}</span> products
                </span>
                <button
                  className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-white font-semibold hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
                  disabled={currentPage >= state.data.pagination.totalPages - 1}
                  onClick={() => {
                    // ✅ Scroll to top smoothly for better pagination UX
                    window.scrollTo(0, 0);
                    const newPage = Math.min(state.data!.pagination.totalPages - 1, currentPage + 1);
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.set("page", String(newPage));
                    setSearchParams(nextParams, { replace: true });
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
