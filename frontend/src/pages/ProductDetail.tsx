import { useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, AlertCircle } from "lucide-react";
import { useProductDetail, useProductSignals, useProductInsights } from "@/hooks/queries/useProduct";
import { useEvidenceReviews } from "@/hooks/queries/useEvidence";
import { AIAnalystPanel } from "@/components/ai/AIAnalystPanel";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { MetricCard } from "@/components/intelligence/MetricCard";
import { KpiSkeleton } from "@/components/intelligence/KpiSkeleton";
import { RatingDistribution } from "@/components/intelligence/RatingDistribution";
import { SentimentDistribution } from "@/components/intelligence/SentimentDistribution";
import { EarlyWarningCard } from "@/components/intelligence/EarlyWarningCard";
import { ConfidenceBadge } from "@/components/intelligence/ConfidenceBadge";
import { EvidenceList } from "@/components/intelligence/EvidenceList";
import { EvidenceDrawer } from "@/components/intelligence/EvidenceDrawer";
import { ReviewsList } from "@/components/intelligence/ReviewDetail";
import { AIInsightCard } from "@/components/ai/AIInsightCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import { splitSignalsByReadiness } from "@/lib/signals";
import type { NamedWindow, Platform } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

/**
 * Phase 8 Step 6 — Product Intelligence Investigation Surface. Every number
 * comes directly from GET /v1/products/:platform/:sourceProductId and related
 * endpoints (/signals, /insights on explicit request) — no client-side
 * analytics, no invented severity/confidence/theme data. Product Detail is
 * the strongest investigation page in the application, leading users from
 * product identity → current health → signals/warnings → evidence citations
 * → AI interpretation (if requested) → honest capability boundaries.
 */
export function ProductDetail() {
  const navigate = useNavigate();
  const params = useParams<{ platform: Platform; sourceProductId: string }>();
  const platform = params.platform!;
  const sourceProductId = params.sourceProductId!;
  const [searchParams, setSearchParams] = useSearchParams();

  // Context-aware back navigation
  const backFrom = searchParams.get("from");
  const rankingPlatform = searchParams.get("platform");
  const rankingType = searchParams.get("type");
  const rankingPage = searchParams.get("page");

  const handleBack = () => {
    if (backFrom === "ranking" && rankingPlatform && rankingType) {
      // Return to the ranking page that sent us here, preserving pagination
      const backUrl = rankingPage
        ? `/reviews-overview/${rankingPlatform}/${rankingType}?page=${rankingPage}`
        : `/reviews-overview/${rankingPlatform}/${rankingType}`;
      navigate(backUrl);
    } else {
      // Default: return to products list
      navigate("/products");
    }
  };
  const window_ = readWindowParam(searchParams.get("window"));

  function handleWindowChange(next: NamedWindow) {
    const next_ = new URLSearchParams(searchParams);
    next_.set("window", next);
    setSearchParams(next_, { replace: true });
  }

  const detailQuery = useProductDetail(platform, sourceProductId, window_);
  const signalsQuery = useProductSignals(platform, sourceProductId, window_);

  const [requestedForKey, setRequestedForKey] = useState<string | null>(null);
  const currentKey = `${platform}:${sourceProductId}:${window_}`;
  const insightRequested = requestedForKey === currentKey;

  const insightsQuery = useProductInsights(platform, sourceProductId, window_, insightRequested);

  const { active: activeSignals, notReadyGroups } = useMemo(
    () => splitSignalsByReadiness(signalsQuery.data?.signals ?? []),
    [signalsQuery.data],
  );

  const evidenceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of activeSignals) for (const id of s.evidenceReviewIds) ids.add(id);
    return [...ids];
  }, [activeSignals]);

  const hasActiveWarnings = activeSignals.length > 0;
  const reviewsQuery = useEvidenceReviews(evidenceIds, evidenceIds.length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main product content - left side (2/3 on desktop, full on mobile) */}
      <div className="lg:col-span-2 space-y-6">
        {/* Product header with context and navigation */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {backFrom === "ranking" && rankingType
              ? `Back to ${rankingType === "negative" ? "Negative" : "Positive"} Reviews`
              : "Back to Products"}
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{sourceProductId}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border bg-muted px-3 py-1 text-xs font-medium capitalize text-muted-foreground">{platform}</span>
              {detailQuery.data?.analytics.brand && (
                <span className="text-sm text-muted-foreground">{detailQuery.data.analytics.brand}</span>
              )}
              {detailQuery.data?.analytics.brandInconsistent && (
                <span className="text-xs text-amber-600 dark:text-amber-400">Brand inconsistency detected</span>
              )}
              {hasActiveWarnings && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                  <AlertCircle className="size-3" />
                  Active warnings
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <WindowSelector value={window_} onChange={handleWindowChange} />
        </div>
      </div>

      {detailQuery.isError ? (
        <ErrorState error={detailQuery.error} onRetry={() => detailQuery.refetch()} />
      ) : detailQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
      ) : (
        <>
          {/* Headline Intelligence: Current health snapshot */}
          <section aria-labelledby="headline-heading" className="space-y-3">
            <h2 id="headline-heading" className="text-sm font-semibold">
              Current Health
            </h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <MetricCard
                label="Rating"
                value={
                  detailQuery.data.analytics.recentMetrics.averageRating === null ? null : detailQuery.data.analytics.recentMetrics.averageRating.toFixed(2)
                }
              />
              <MetricCard label="Review count" value={detailQuery.data.analytics.recentMetrics.totalReviews} />
              <MetricCard
                label="Rating score"
                value={detailQuery.data.health.ratingScore}
                hint="0–100 health-score scale"
              />
              <MetricCard
                label="Trend"
                value={detailQuery.data.analytics.trendDirection}
                hint={`Trend score ${detailQuery.data.health.trendScore}`}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sample confidence:</span>
              <ConfidenceBadge value={detailQuery.data.analytics.recentMetrics.confidence} />
            </div>
          </section>

          {/* Health Performance: Detailed score breakdown */}
          <section aria-labelledby="health-heading" className="space-y-3">
            <h2 id="health-heading" className="text-sm font-semibold">
              Health Performance
            </h2>
            <Card>
              <CardContent className="pt-6">
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <div>
                    <dt className="text-xs text-muted-foreground">Rating Score</dt>
                    <dd className="text-lg font-semibold tabular-nums">{detailQuery.data.health.ratingScore}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Trend Score</dt>
                    <dd className="text-lg font-semibold tabular-nums">{detailQuery.data.health.trendScore}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Sentiment Score</dt>
                    <dd className="text-lg font-semibold tabular-nums text-muted-foreground">
                      {detailQuery.data.health.sentimentScore ?? "Not available yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Complaint Score</dt>
                    <dd className="text-lg font-semibold tabular-nums text-muted-foreground">
                      {detailQuery.data.health.complaintScore ?? "Not available yet"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Severity Score</dt>
                    <dd className="text-lg font-semibold tabular-nums text-muted-foreground">Not available yet</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-muted-foreground">
                  Total score: <span className="font-medium">Not available yet</span> — no approved formula combines these components yet.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* Rating & Sentiment Analysis */}
          <section aria-labelledby="analysis-heading" className="space-y-3">
            <h2 id="analysis-heading" className="text-sm font-semibold">
              Customer Feedback Analysis
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Rating Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {detailQuery.data.analytics.recentMetrics.totalReviews === 0 ? (
                    <InsufficientDataState />
                  ) : (
                    <RatingDistribution distribution={detailQuery.data.analytics.recentMetrics.ratingDistribution} />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Sentiment Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {detailQuery.data.analytics.recentMetrics.positivePercentage === null &&
                  detailQuery.data.analytics.recentMetrics.negativePercentage === null &&
                  detailQuery.data.analytics.recentMetrics.neutralPercentage === null ? (
                    <InsufficientDataState />
                  ) : (
                    <SentimentDistribution
                      positivePercentage={detailQuery.data.analytics.recentMetrics.positivePercentage}
                      negativePercentage={detailQuery.data.analytics.recentMetrics.negativePercentage}
                      neutralPercentage={detailQuery.data.analytics.recentMetrics.neutralPercentage}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Active Signals & Warnings */}
          <section aria-labelledby="signals-heading" className="space-y-3">
            <h2 id="signals-heading" className="text-sm font-semibold">
              Active Signals & Warnings
            </h2>
            {signalsQuery.isError ? (
              <ErrorState error={signalsQuery.error} onRetry={() => signalsQuery.refetch()} />
            ) : signalsQuery.isPending ? (
              <LoadingState rows={3} />
            ) : activeSignals.length === 0 ? (
              <EmptyState title="No active signals for this period" />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {activeSignals.map((s, i) => (
                  <EarlyWarningCard key={`${s.signalType}:${i}`} signal={s} />
                ))}
              </div>
            )}
            {notReadyGroups.length > 0 && (
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Not Available Yet</p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {notReadyGroups.map(([signalType]) => (
                          <li key={signalType}>
                            <span className="capitalize">{signalType.replace(/_/g, " ")}</span> — not currently available.
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          {/* Evidence & Citations */}
          <section aria-labelledby="evidence-heading" className="space-y-3">
            <h2 id="evidence-heading" className="text-sm font-semibold">
              Supporting Evidence
            </h2>
            {evidenceIds.length === 0 ? (
              <EmptyState
                title="No cited evidence for this period"
                description="Review citations appear here once signals are detected."
              />
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {evidenceIds.length} review{evidenceIds.length !== 1 ? "s" : ""} cited as evidence for active signals.
                </p>
                <div className="space-y-3">
                  <EvidenceList reviewIds={evidenceIds} />
                  <EvidenceDrawer reviewIds={evidenceIds} />
                </div>

                {/* Actual Review Investigation */}
                <div className="mt-6 border-t pt-6">
                  <h3 className="mb-3 text-sm font-semibold">Supporting Reviews</h3>
                  {reviewsQuery.isPending ? (
                    <LoadingState rows={3} />
                  ) : reviewsQuery.isError ? (
                    <ErrorState error={reviewsQuery.error} onRetry={() => reviewsQuery.refetch()} />
                  ) : (
                    <ReviewsList reviews={reviewsQuery.data?.reviews ?? []} />
                  )}
                </div>
              </>
            )}
          </section>

          {/* AI Interpretation */}
          <section aria-labelledby="ai-heading" className="space-y-3">
            <h2 id="ai-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-violet-600" />
              AI Interpretation
            </h2>

            {!insightRequested ? (
              <Card className="border-violet-200/50 bg-violet-50/30">
                <CardContent className="flex flex-col gap-4 py-8">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Ask AI to analyze this product</p>
                    <p className="text-xs text-muted-foreground">
                      AI will examine the trends, themes, and patterns in the {window_ === "7d" ? "last 7 days" : window_ === "30d" ? "last 30 days" : window_ === "60d" ? "last 60 days" : window_ === "90d" ? "last 90 days" : window_ === "6m" ? "last 6 months" : "last 12 months"} for <strong className="text-foreground">{sourceProductId}</strong> on {platform === "flipkart" ? "Flipkart" : "Myntra"}.
                    </p>
                  </div>

                  <div className="grid gap-2 rounded-sm bg-white/50 p-3 text-xs text-muted-foreground">
                    <div className="flex gap-2">
                      <span className="text-violet-600">✓</span>
                      <span>Root causes of rating changes and review patterns</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-violet-600">✓</span>
                      <span>Actionable recommendations based on detected signals</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-violet-600">✓</span>
                      <span>Grounded metrics verified against actual product data</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-amber-600">→</span>
                      <span>Unverified claims AI stated but data did not confirm</span>
                    </div>
                  </div>

                  <Button onClick={() => setRequestedForKey(currentKey)} className="w-full sm:w-auto">
                    <Sparkles className="size-4" />
                    Ask AI for Insight
                  </Button>
                </CardContent>
              </Card>
            ) : insightsQuery.isPending ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Analyzing patterns and signals...</p>
                <LoadingState rows={3} />
              </div>
            ) : insightsQuery.isError ? (
              <ErrorState error={insightsQuery.error} onRetry={() => insightsQuery.refetch()} />
            ) : (
              <AIInsightCard insight={insightsQuery.data.insight} />
            )}
          </section>

          {/* Marketplace Context & Capabilities */}
          <section aria-labelledby="context-heading" className="space-y-3">
            <h2 id="context-heading" className="text-sm font-semibold">
              Context & Capabilities
            </h2>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="space-y-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium">Marketplace View</p>
                    <p>
                      This page shows {platform === "flipkart" ? "Flipkart" : "Myntra"} data only. Cross-marketplace product comparison is not available from this view.
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">Data Availability</p>
                    <p>
                      Review citations are provided as supporting evidence. Full review content, detailed review-level drill-down, and theme-specific filtering are not available from the current Product Intelligence API.
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">Investigation Path</p>
                    <p>
                      To explore products by ranking, health metrics, or signal frequency across the catalog, use the Rankings view or Problems view. To compare this product with similar products, use the Product Family Comparison tool.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      )}
      </div>

      {/* AI Analyst Panel - right side (1/3 on desktop, full on mobile) */}
      <div className="lg:col-span-1">
        <div className="sticky top-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="size-4 text-violet-600" />
                AI Analyst
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AIAnalystPanel
                platform={platform}
                productId={sourceProductId}
                showProductSelection={false}
                compact={true}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
