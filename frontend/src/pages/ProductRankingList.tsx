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

  // Cache key for this ranking (static data, safe to cache)
  const cacheKey = `ranking-${platform}-${type}-${currentPage}`;

  // Get cached data if available and fresh (5 min TTL)
  const getCachedData = () => {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
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

        const result = await getReviewsOverview({
          platform: platform as "flipkart" | "myntra",
          type: type as "negative" | "positive",
          page: currentPage,
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
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : "Error loading data",
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
  }, [platform, type, currentPage, navigate, state.loading]);

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

  // Listen for WebSocket product updates
  useWebSocketEvent("PRODUCT_DATA_UPDATED", (event) => {
    console.log("[ProductRankingList] WebSocket event received:", {
      eventPlatform: event.platform,
      currentPlatform: platform,
      hasStateData: !!state.data,
      hasType: !!type
    });
    if (!platform || !type || !state.data) {
      console.log("[ProductRankingList] Skipping event - missing required data");
      return;
    }
    if (event.platform !== platform) {
      console.log(`[ProductRankingList] Skipping event - platform mismatch: ${event.platform} !== ${platform}`);
      return;
    }

    // Find the product in current cached data
    const productIndex = state.data.products.findIndex(
      (p) => p.sourceProductId === event.sourceProductId
    );

    if (productIndex === -1) return; // Product not on this page

    // ✅ Invalidate the cache for this page to force refresh on next navigation
    try {
      sessionStorage.removeItem(cacheKey);
    } catch (e) {
      // Silently ignore
    }

    // ✅ Update only the affected product row to show fresh data
    // Fetch fresh data for just this product from server (or use optimistic update if needed)
    setState((prev) => {
      if (!prev.data) return prev;

      // For now, mark as needing refresh by re-fetching the entire list
      // This is the safest approach to ensure ProductRowMemo updates correctly
      return prev;
    });

    // ✅ Force a silent refresh of the data
    // Re-fetch with the same parameters to get fresh product stats
    const performRefresh = async () => {
      console.log("[ProductRankingList] Calling getReviewsOverview to refresh data");
      try {
        const result = await getReviewsOverview({
          platform: platform as "flipkart" | "myntra",
          type: type as "negative" | "positive",
          page: currentPage,
        });
        console.log("[ProductRankingList] API refresh completed");

        setState((prev) => ({ ...prev, data: result, loading: false }));

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
  });

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="relative max-w-5xl mx-auto px-6 py-12">
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
          <div className="flex items-center gap-4 mb-4">
            <span className="text-5xl">{typeIcon}</span>
            <div>
              <h1 className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                {platformLabel} — {typeLabel}
              </h1>
              <p className="text-gray-400 mt-2">
                Ranked by {type} sentiment • 100 products per page • Based on latest 10 reviews
              </p>
            </div>
          </div>
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
