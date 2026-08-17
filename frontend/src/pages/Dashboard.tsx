import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Boxes, TriangleAlert, Star, CircleCheck, ArrowRight, MessagesSquare } from "lucide-react";
import { useExecutiveDashboard, useEarlyWarnings, useProblems } from "@/hooks/queries/useCategoryC";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { MetricCard } from "@/components/intelligence/MetricCard";
import { KpiSkeleton } from "@/components/intelligence/KpiSkeleton";
import { MoverCard } from "@/components/intelligence/MoverCard";
import { EarlyWarningCard } from "@/components/intelligence/EarlyWarningCard";
import { StatusBadge } from "@/components/intelligence/StatusBadge";
import { ConfidenceBadge } from "@/components/intelligence/ConfidenceBadge";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { splitSignalsByReadiness } from "@/lib/signals";
import type { NamedWindow } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";
const TOP_PROBLEMS_SHOWN = 3;

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

/**
 * Phase 7 Step 2 / Phase 8 Step 2 — the Executive Dashboard. Every number on
 * this page comes directly from GET /v1/dashboard/executive,
 * GET /v1/early-warnings, and GET /v1/problems — this component computes
 * nothing analytical of its own (no new formula, no derived severity, no
 * client-side ranking). The backend is authoritative.
 *
 * Phase 8 Step 2 — restructured around a HOW ARE WE DOING → WHAT NEEDS
 * ATTENTION → WHAT CHANGED hierarchy (Step 0 plan's mental model), instead
 * of three equal-weight KPI cards followed by movers followed by warnings.
 * `activeAlertCount` moved out of the neutral KPI row and into the
 * Attention section it actually describes; `averageRatingScore` is now the
 * one visually dominant "how are we doing" number. A Top Problem Themes
 * panel was added (GET /v1/problems, already used elsewhere in the app —
 * no new endpoint) because the Step 0 mental model explicitly names
 * "problems" alongside "warnings" as part of the Attention level; it shows
 * only the backend's own top-N by mentionCount, a presentational trim of
 * already-sorted real data, never a new ranking. There is no dashboard-
 * level "vs previous period" indicator for productCount/activeAlertCount/
 * averageRatingScore — the API returns no prior-period value for any of
 * the three, so none is shown; the only real change signals on this page
 * remain trendScore (on each mover, unchanged) and delta-vs-threshold (on
 * each warning, unchanged). No AI content appears on this page — Dashboard
 * has never called and still does not call the AI insights endpoint; the
 * "why" step of the journey is reached by drilling into Product Detail,
 * which already has it.
 */
export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const window_ = readWindowParam(searchParams.get("window"));

  function handleWindowChange(next: NamedWindow) {
    const params = new URLSearchParams(searchParams);
    params.set("window", next);
    setSearchParams(params, { replace: true });
  }

  const dashboardQuery = useExecutiveDashboard(window_);
  const warningsQuery = useEarlyWarnings({ window: window_ });
  const problemsQuery = useProblems({ window: window_ });

  // §10: product_deterioration (and any other not_ready signal) is a
  // real, permanent gap — never rendered as an active warning. Grouped by
  // signalType with a count rather than listed per-product: the backend
  // returns one not_ready product_deterioration entry per product in the
  // whole catalog scan, and repeating the identical explanation hundreds
  // of times would bury the page, not inform it.
  const { active: activeWarnings, notReadyGroups } = useMemo(
    () => splitSignalsByReadiness(warningsQuery.data?.signals ?? []),
    [warningsQuery.data],
  );

  // Presentational trim only — the backend already sorts themes by
  // mentionCount DESC (problemsAggregate.ts); this just decides how many
  // of that real, already-ordered list to show on a summary card.
  const topProblems = useMemo(() => problemsQuery.data?.themes.slice(0, TOP_PROBLEMS_SHOWN) ?? [], [problemsQuery.data]);

  const dashboard = dashboardQuery.data;
  const windowQuery = `?window=${window_}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Executive Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">How is the whole catalog doing, and what needs attention right now?</p>
        </div>
        <WindowSelector value={window_} onChange={handleWindowChange} />
      </div>

      {dashboardQuery.isError ? (
        <ErrorState error={dashboardQuery.error} onRetry={() => dashboardQuery.refetch()} />
      ) : (
        <>
          {/* Level 1 — HOW ARE WE DOING: averageRatingScore is the one
              visually dominant number on the page (MetricCard size="lg");
              productCount is real supporting context, not competing for
              the same attention. */}
          <section aria-labelledby="status-heading">
            <h2 id="status-heading" className="sr-only">
              Catalog status
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {dashboardQuery.isPending ? (
                <>
                  <KpiSkeleton />
                  <KpiSkeleton />
                </>
              ) : (
                <>
                  <MetricCard
                    label="Average rating score"
                    value={dashboard!.averageRatingScore === null ? null : dashboard!.averageRatingScore.toFixed(1)}
                    hint={
                      dashboard!.averageRatingScore === null
                        ? "No rated products in this window"
                        : "0–100 health-score scale, not a 1–5 star average"
                    }
                    icon={<Star className="size-4 text-muted-foreground" />}
                    size="lg"
                    className="sm:col-span-2"
                  />
                  <MetricCard label="Product count" value={dashboard!.productCount} icon={<Boxes className="size-4 text-muted-foreground" />} />
                </>
              )}
            </div>
            {!dashboardQuery.isPending && (
              <Link to="/products" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                Browse full catalog
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            )}
          </section>

          {!dashboardQuery.isPending && dashboard!.productCount === 0 ? (
            <EmptyState title="No products ingested yet" description="Once products with reviews exist, catalog health will appear here." icon={Boxes} />
          ) : (
            <>
              {/* Level 2 — WHAT NEEDS ATTENTION: warnings + problems,
                  fronted by a real-count status callout (tone chosen from
                  the real activeAlertCount value — 0 vs. >0 — never an
                  invented severity ranking). */}
              <section aria-labelledby="attention-heading" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="attention-heading" className="text-sm font-semibold">
                    Attention
                  </h2>
                  {!dashboardQuery.isPending && (
                    <StatusBadge
                      tone={dashboard!.activeAlertCount > 0 ? "warning" : "success"}
                      icon={dashboard!.activeAlertCount > 0 ? TriangleAlert : CircleCheck}
                      label={`${dashboard!.activeAlertCount} active alert${dashboard!.activeAlertCount === 1 ? "" : "s"}`}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Early warnings</h3>
                    <Link to={`/warnings${windowQuery}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      View all warnings
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                  {warningsQuery.isError ? (
                    <ErrorState error={warningsQuery.error} onRetry={() => warningsQuery.refetch()} />
                  ) : warningsQuery.isPending ? (
                    <LoadingState rows={3} />
                  ) : activeWarnings.length === 0 ? (
                    <EmptyState
                      title="No active warnings for this period"
                      description="This is a real analytical result, not an error."
                      icon={TriangleAlert}
                    />
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {activeWarnings.map((s, i) => (
                        <EarlyWarningCard key={`${s.platform}:${s.sourceProductId}:${s.signalType}:${i}`} signal={s} />
                      ))}
                    </div>
                  )}

                  {notReadyGroups.length > 0 && (
                    <div className="rounded-lg border border-dashed p-3">
                      <p className="text-xs font-medium text-muted-foreground">Not Available Yet</p>
                      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {notReadyGroups.map(([signalType, count]) => (
                          <li key={signalType}>
                            <span className="capitalize">{signalType.replace(/_/g, " ")}</span> — this signal is not currently available. ({count} product
                            {count === 1 ? "" : "s"} checked)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Top problem themes</h3>
                    <Link to={`/problems${windowQuery}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      View all problems
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                  {problemsQuery.isError ? (
                    <ErrorState error={problemsQuery.error} onRetry={() => problemsQuery.refetch()} />
                  ) : problemsQuery.isPending ? (
                    <LoadingState rows={3} />
                  ) : topProblems.length === 0 ? (
                    <EmptyState title="No recurring problems found for this period" description="This is a real analytical result, not an error." icon={MessagesSquare} />
                  ) : (
                    <ul className="space-y-2">
                      {topProblems.map((t) => (
                        <li key={t.theme} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm">
                          <span className="font-medium capitalize">{t.theme.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground">
                            {t.mentionCount} mention{t.mentionCount === 1 ? "" : "s"} · {t.distinctProductCount} product
                            {t.distinctProductCount === 1 ? "" : "s"}
                          </span>
                          <ConfidenceBadge value={t.confidence} className="ml-auto" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* Level 3 — WHAT CHANGED: movers, ordered by the backend's
                  own trendScore. No client-side re-ranking. */}
              <div className="grid gap-4 lg:grid-cols-2">
                <section aria-labelledby="top-movers-heading" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="top-movers-heading" className="text-sm font-semibold">
                      Top Movers
                    </h2>
                    <Link to="/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      Rankings
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                  {dashboardQuery.isPending ? (
                    <LoadingState rows={4} />
                  ) : dashboard!.topMovers.length === 0 ? (
                    <EmptyState title="No movers to show" />
                  ) : (
                    <div className="space-y-2">
                      {dashboard!.topMovers.map((entry) => (
                        <MoverCard key={`${entry.platform}:${entry.sourceProductId}`} entry={entry} />
                      ))}
                    </div>
                  )}
                </section>

                <section aria-labelledby="bottom-movers-heading" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="bottom-movers-heading" className="text-sm font-semibold">
                      Bottom Movers
                    </h2>
                    <Link to="/marketplace/brands" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      Compare marketplaces
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Link>
                  </div>
                  {dashboardQuery.isPending ? (
                    <LoadingState rows={4} />
                  ) : dashboard!.bottomMovers.length === 0 ? (
                    <EmptyState title="No movers to show" />
                  ) : (
                    <div className="space-y-2">
                      {dashboard!.bottomMovers.map((entry) => (
                        <MoverCard key={`${entry.platform}:${entry.sourceProductId}`} entry={entry} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
