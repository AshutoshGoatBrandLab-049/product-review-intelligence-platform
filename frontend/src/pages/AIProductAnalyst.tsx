import { useSearchParams, useNavigate } from "react-router-dom";
import { Sparkles, ArrowLeft } from "lucide-react";
import { AIAnalystPanel } from "@/components/ai/AIAnalystPanel";
import type { Platform } from "@/types/api";

/**
 * Phase 10 — AI Product Analyst with team-shared conversation persistence.
 * Team members select a product and share investigation history via conversations.
 * One conversation per (platform, product) — visible to all authorized team members.
 * Question scope (overall/last-N-days/latest-N-reviews) is determined from the user's
 * natural-language question, not from a UI selector. The server performs a fresh
 * database query for EVERY question using the scope detected from that question.
 * Conversation history is used only for context; answers NEVER come from cached
 * previous responses — they always reflect the current database state.
 */

export default function AIProductAnalyst() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPlatform = (searchParams.get("platform") as Platform) || "flipkart";
  const initialProductId = searchParams.get("productId") || "";
  const fromRanking = searchParams.get("from") === "ranking";
  const rankingType = searchParams.get("type");
  const rankingPage = searchParams.get("page");

  const handleBack = () => {
    if (fromRanking && rankingType && rankingPage) {
      navigate(`/reviews-overview/${initialPlatform}/${rankingType}?page=${rankingPage}`);
    } else if (fromRanking && rankingType) {
      navigate(`/reviews-overview/${initialPlatform}/${rankingType}`);
    } else {
      navigate("/reviews-overview");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Back Navigation */}
      {fromRanking && (
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-3 py-3 rounded text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to {rankingType === "negative" ? "Negative" : "Positive"} Reviews
        </button>
      )}

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Sparkles className="size-5 text-violet-600" />
          <h1 className="text-2xl font-bold">AI Product Analyst</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Team investigation workspace. All authorized team members see the same product analysis and reviews.
        </p>
      </div>

      {/* AI Analyst Panel with product selection enabled */}
      <AIAnalystPanel
        platform={initialPlatform}
        productId={initialProductId}
        showProductSelection={true}
        compact={false}
      />
    </div>
  );
}
