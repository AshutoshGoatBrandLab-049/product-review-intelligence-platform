import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useBrandComparison } from "@/hooks/queries/useMarketplace";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { MarketplacePlatformCard } from "@/components/intelligence/MarketplacePlatformCard";
import { ThemeConsistencyTable } from "@/components/intelligence/ThemeConsistencyTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import type { NamedWindow } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

/**
 * Phase 7 Step 7 — Brand Marketplace Comparison. Every number comes
 * directly from GET /v1/brands/:brand/compare — no client-side rating
 * gap, percentage, or classification math. `window` is the only real
 * query parameter this endpoint supports (WindowQuerySchema); `brand` is a
 * route param, not filterable further. compareBrandAcrossMarketplaces
 * joins purely on product_dimension.brand per platform — there is no
 * cross-platform product-ID mapping involved at the brand level (verified
 * by source; that's exclusively /v1/products/family/:familyId/compare's
 * concern, out of scope this step).
 */
export function BrandComparison() {
  const { brand } = useParams<{ brand: string }>();
  const brand_ = brand ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const window_ = readWindowParam(searchParams.get("window"));

  function handleWindowChange(next: NamedWindow) {
    const params = new URLSearchParams(searchParams);
    params.set("window", next);
    setSearchParams(params, { replace: true });
  }

  const comparisonQuery = useBrandComparison(brand_, window_);

  // The backend's top-level `ratingComparison` reuses comparePeriods with
  // a platform's averageRating substituted for 0 when that platform has no
  // reviews (see marketplaceComparison.ts) — a real backend behavior, not
  // recomputed here, but showing that 0-substituted gap as a headline
  // number would misleadingly read as "this marketplace is rated 0 stars."
  // It's only shown when both sides have a genuine, non-null average.
  const bothSidesRated =
    comparisonQuery.data?.flipkart.recentMetrics.averageRating !== null && comparisonQuery.data?.myntra.recentMetrics.averageRating !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link to="/marketplace/brands" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" />
            Back to Marketplace
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{brand_}</h1>
          <p className="text-sm text-muted-foreground">Flipkart vs Myntra performance for this brand.</p>
        </div>
        <WindowSelector value={window_} onChange={handleWindowChange} />
      </div>

      {comparisonQuery.isError ? (
        <ErrorState error={comparisonQuery.error} onRetry={() => comparisonQuery.refetch()} />
      ) : comparisonQuery.isPending ? (
        <LoadingState rows={6} />
      ) : (
        <>
          {bothSidesRated ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Rating gap (Flipkart − Myntra)</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Flipkart avg</dt>
                    <dd className="text-lg font-semibold tabular-nums">{comparisonQuery.data.ratingComparison.current.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Myntra avg</dt>
                    <dd className="text-lg font-semibold tabular-nums">{comparisonQuery.data.ratingComparison.previous.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Gap</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {comparisonQuery.data.ratingComparison.absoluteDelta.toFixed(2)}
                      {comparisonQuery.data.ratingComparison.percentageDelta !== null && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({comparisonQuery.data.ratingComparison.percentageDelta}%)
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : (
            <InsufficientDataState className="text-sm" />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <MarketplacePlatformCard label="Flipkart" analytics={comparisonQuery.data.flipkart} />
            <MarketplacePlatformCard label="Myntra" analytics={comparisonQuery.data.myntra} />
          </div>

          <section aria-labelledby="theme-consistency-heading" className="space-y-3">
            <h2 id="theme-consistency-heading" className="text-sm font-semibold">
              Theme consistency across marketplaces
            </h2>
            {comparisonQuery.data.themeConsistency.length === 0 ? (
              <EmptyState title="No themes to compare for this period" description="This is a real analytical result, not an error." />
            ) : (
              <ThemeConsistencyTable entries={comparisonQuery.data.themeConsistency} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
