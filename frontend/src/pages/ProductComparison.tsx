import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useFamilyComparison } from "@/hooks/queries/useMarketplace";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { MarketplacePlatformCard } from "@/components/intelligence/MarketplacePlatformCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { NoMappingState } from "@/components/states/NoMappingState";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import type { NamedWindow } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

/**
 * Phase 7 Step 8 — Product Marketplace Comparison. Every number comes
 * directly from GET /v1/products/family/:familyId/compare — no client-side
 * rating gap or matching logic. `familyId` is a route param (must be a
 * real UUID — the backend 400s otherwise, surfaced via the normal
 * ErrorState "validation" path), `window` is the only query param this
 * endpoint supports.
 *
 * product_family_mapping is genuinely empty in the real dataset today
 * (verified by direct query before writing this page, and again in the
 * Step 8 real-data validation script) — every real familyId therefore
 * resolves to `available: false, reason: "no_mapping"`, rendered via the
 * existing NoMappingState. This page never fabricates a comparison to
 * "fill in" that gap; the `available: true` branch below is exercised
 * only by mocked data in tests and will only ever render for real once a
 * mapping row is deliberately added (out of scope for this step and
 * every prior one — see the Phase 5 plan's explicit descope).
 */
export function ProductComparison() {
  const { familyId } = useParams<{ familyId: string }>();
  const familyId_ = familyId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const window_ = readWindowParam(searchParams.get("window"));

  function handleWindowChange(next: NamedWindow) {
    const params = new URLSearchParams(searchParams);
    params.set("window", next);
    setSearchParams(params, { replace: true });
  }

  const comparisonQuery = useFamilyComparison(familyId_, window_);

  const bothSidesRated =
    comparisonQuery.data?.available === true &&
    comparisonQuery.data.flipkart.recentMetrics.averageRating !== null &&
    comparisonQuery.data.myntra.recentMetrics.averageRating !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link to="/marketplace/brands" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" />
            Back to Marketplace
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Product Comparison</h1>
          <p className="font-mono text-xs text-muted-foreground">{familyId_}</p>
        </div>
        <WindowSelector value={window_} onChange={handleWindowChange} />
      </div>

      {comparisonQuery.isError ? (
        <ErrorState error={comparisonQuery.error} onRetry={() => comparisonQuery.refetch()} />
      ) : comparisonQuery.isPending ? (
        <LoadingState rows={6} />
      ) : !comparisonQuery.data.available ? (
        <NoMappingState />
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
            <MarketplacePlatformCard
              label="Flipkart"
              platform="flipkart"
              sourceProductId={comparisonQuery.data.flipkartSourceProductId}
              analytics={comparisonQuery.data.flipkart}
            />
            <MarketplacePlatformCard
              label="Myntra"
              platform="myntra"
              sourceProductId={comparisonQuery.data.myntraSourceProductId}
              analytics={comparisonQuery.data.myntra}
            />
          </div>
        </>
      )}
    </div>
  );
}
