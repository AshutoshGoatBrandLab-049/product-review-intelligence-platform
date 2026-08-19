import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, BarChart3, Loader } from "lucide-react";
import { getReviewsOverview, type ReviewsOverviewResponse } from "@/api/endpoints/reviews";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface ListState {
  data: ReviewsOverviewResponse | null;
  loading: boolean;
  error: string | null;
  page: number;
}


export function ProductRankingList() {
  const navigate = useNavigate();
  const { platform, type } = useParams<{ platform: string; type: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read page from URL, default to 0 (zero-based internally)
  const pageFromUrl = parseInt(searchParams.get("page") || "0", 10);
  const currentPage = Math.max(0, isNaN(pageFromUrl) ? 0 : pageFromUrl);

  const [state, setState] = useState<ListState>({
    data: null,
    loading: false,
    error: null,
    page: currentPage,
  });

  // Validate params
  const isValidPlatform = platform === "flipkart" || platform === "myntra";
  const isValidType = type === "negative" || type === "positive";

  useEffect(() => {
    if (!isValidPlatform || !isValidType) {
      navigate("/reviews-overview");
      return;
    }
    fetchData(platform as "flipkart" | "myntra", type as "negative" | "positive", currentPage);
  }, [platform, type, currentPage, isValidPlatform, isValidType]);

  async function fetchData(plat: "flipkart" | "myntra", sentimentType: "negative" | "positive", page: number) {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      const result = await getReviewsOverview({ platform: plat, type: sentimentType, page });
      setState((prev) => ({ ...prev, data: result, loading: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Error loading data",
        loading: false,
      }));
    }
  }

  const handleProductClick = (sourceProductId: string) => {
    // Pass ranking context so ProductDetail can navigate back correctly, including pagination
    navigate(
      `/products/${platform}/${sourceProductId}?from=ranking&platform=${platform}&type=${type}&page=${currentPage}`,
    );
  };

  const handleAIAnalystClick = (sourceProductId: string) => {
    // Navigate to AI Analyst with product pre-populated and ranking context for back navigation
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
        {state.loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader className="w-12 h-12 text-purple-400 animate-spin mb-4" />
            <p className="text-gray-400 text-lg">Loading products...</p>
          </div>
        )}

        {/* Products Table */}
        {state.data && (
          <>
            {state.data.products.length > 0 ? (
              <Table className="mb-12">
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
                  {state.data.products.map((product) => {
                    const displayPercent = type === "negative"
                      ? Math.round((product.negativeCount / product.totalInLatestTen) * 100)
                      : Math.round((product.positiveCount / product.totalInLatestTen) * 100);

                    // Handle averageRating which might be a string from database
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
                              onClick={() => handleProductClick(product.sourceProductId)}
                              className="px-2 py-1 rounded text-xs font-medium text-purple-300 hover:text-purple-200 hover:bg-purple-950/50 transition-colors"
                              title="View detailed product information"
                            >
                              View Details
                            </button>
                            <button
                              onClick={() => handleAIAnalystClick(product.sourceProductId)}
                              className="px-2 py-1 rounded text-xs font-medium text-violet-300 hover:text-violet-200 hover:bg-violet-950/50 transition-colors"
                              title="Open AI Analyst dashboard for this product"
                            >
                              AI Dashboard
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
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
