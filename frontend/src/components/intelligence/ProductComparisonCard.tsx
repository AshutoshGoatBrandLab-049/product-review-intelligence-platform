import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { RatingDistribution } from "./RatingDistribution";
import { SentimentDistribution } from "./SentimentDistribution";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import type { Platform, ProductAnalytics } from "@/types/api";

/**
 * Phase 7 Step 8 — one platform's half of a product-family marketplace
 * comparison. Only ever rendered when the backend's own `available: true`
 * branch already confirmed `platform`/`sourceProductId` via a real
 * product_family_mapping row — this component does not decide or guess
 * that mapping itself, it only displays what compareProductByFamily
 * already resolved. The drill-down link is safe for the same reason: the
 * ID came from the backend's confirmed mapping, not a frontend guess.
 */
export function ProductComparisonCard({ label, platform, sourceProductId, analytics }: { label: string; platform: Platform; sourceProductId: string; analytics: ProductAnalytics }) {
  const { recentMetrics } = analytics;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{label}</CardTitle>
        <ConfidenceBadge value={recentMetrics.confidence} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Link to={`/products/${platform}/${encodeURIComponent(sourceProductId)}`} className="font-mono text-xs hover:underline">
            {sourceProductId}
          </Link>
          {analytics.brand && <p className="text-xs text-muted-foreground">{analytics.brand}</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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
