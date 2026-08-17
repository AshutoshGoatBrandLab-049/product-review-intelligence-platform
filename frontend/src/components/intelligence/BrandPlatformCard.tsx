import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { RatingDistribution } from "./RatingDistribution";
import { SentimentDistribution } from "./SentimentDistribution";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import type { BrandAnalytics } from "@/types/api";

/**
 * Phase 7 Step 7 — one platform's half of a brand marketplace comparison.
 * Renders exactly what BrandAnalytics returns — no cross-platform math
 * happens here, that's the parent's `ratingComparison`/`themeConsistency`.
 * A brand with zero products/reviews on this platform is a real, honest
 * result (not an error) — rendered as 0/`—`/InsufficientDataState, never
 * hidden or presented as though the marketplace performed badly.
 */
export function BrandPlatformCard({ label, analytics }: { label: string; analytics: BrandAnalytics }) {
  const { recentMetrics } = analytics;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{label}</CardTitle>
        <ConfidenceBadge value={recentMetrics.confidence} />
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
          <div>
            <dt className="text-muted-foreground">Products</dt>
            <dd className="text-lg font-semibold tabular-nums">{analytics.productCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reviews</dt>
            <dd className="text-lg font-semibold tabular-nums">{recentMetrics.totalReviews}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Avg rating</dt>
            <dd className="text-lg font-semibold tabular-nums">{recentMetrics.averageRating === null ? "—" : recentMetrics.averageRating.toFixed(2)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          Trend vs. prior period: <span className="font-medium capitalize text-foreground">{analytics.trendDirection.replace(/_/g, " ")}</span>
        </p>
        {recentMetrics.totalReviews === 0 ? (
          <InsufficientDataState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <RatingDistribution distribution={recentMetrics.ratingDistribution} />
            {recentMetrics.positivePercentage === null && recentMetrics.negativePercentage === null && recentMetrics.neutralPercentage === null ? (
              <InsufficientDataState />
            ) : (
              <SentimentDistribution
                positivePercentage={recentMetrics.positivePercentage}
                negativePercentage={recentMetrics.negativePercentage}
                neutralPercentage={recentMetrics.neutralPercentage}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
