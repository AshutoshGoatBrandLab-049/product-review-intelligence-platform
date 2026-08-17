import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { RatingDistribution } from "./RatingDistribution";
import { SentimentDistribution } from "./SentimentDistribution";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import type { BrandAnalytics, ProductAnalytics, Platform } from "@/types/api";

type Analytics = BrandAnalytics | ProductAnalytics;

function isBrandAnalytics(analytics: Analytics): analytics is BrandAnalytics {
  return "productCount" in analytics;
}

function isProductAnalytics(analytics: Analytics): analytics is ProductAnalytics {
  return "sourceProductId" in analytics;
}

/**
 * Phase 8 Step 7 — consolidated marketplace platform analytics card.
 * Renders either a brand-level or product-level analytics half, accepting
 * either BrandAnalytics or ProductAnalytics shape (both share CoreMetrics).
 * No cross-platform math — parent handles ratingComparison and any theme
 * consistency. Brand or product ID is passed separately from analytics to
 * keep the component presentational; the caller decides whether to drill down.
 */
export function MarketplacePlatformCard({
  label,
  analytics,
  platform,
  sourceProductId,
}: {
  label: string;
  analytics: Analytics;
  platform?: Platform;
  sourceProductId?: string;
}) {
  const { recentMetrics } = analytics;
  const isBrand = isBrandAnalytics(analytics);
  const isProduct = isProductAnalytics(analytics);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{label}</CardTitle>
        <ConfidenceBadge value={recentMetrics.confidence} />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Brand-specific metadata */}
        {isBrand && (
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
        )}

        {/* Product-specific metadata */}
        {isProduct && platform && sourceProductId && (
          <>
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
          </>
        )}

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
