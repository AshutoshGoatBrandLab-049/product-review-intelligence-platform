import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus, CircleHelp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { RankingsResponseItem, RankingsSort, HealthScore, ProductAnalytics, TrendDirection } from "@/types/api";

function isHealthScore(data: HealthScore | ProductAnalytics): data is HealthScore {
  return "ratingScore" in data;
}

const TREND_CONFIG: Record<TrendDirection, { label: string; icon: typeof TrendingUp; tone: StatusTone }> = {
  improving: { label: "Improving", icon: TrendingUp, tone: "success" },
  declining: { label: "Declining", icon: TrendingDown, tone: "warning" },
  stable: { label: "Stable", icon: Minus, tone: "neutral" },
  insufficient_data: { label: "Not enough data", icon: CircleHelp, tone: "neutral" },
};

/**
 * Phase 8 Step 3 — the mobile/tablet counterpart to RankingsTable, shown
 * below `md` instead of a horizontally-scrolling table (Step 0 audit §10's
 * documented gap: every existing table relied solely on overflow-x-auto).
 * Renders the exact same fields as RankingsTable, from the exact same
 * items array — no different data, no separate fetch, just a layout suited
 * to a narrow viewport. `#N` is the item's real catalog position (derived
 * from the real, already-displayed `page`/`pageSize` plus its index in the
 * already-backend-sorted list) — arithmetic on real pagination values
 * already shown elsewhere on the page, not a new ranking.
 */
export function RankingsCards({ items, sort, page, pageSize }: { items: RankingsResponseItem[]; sort: RankingsSort; page: number; pageSize: number }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={`${item.platform}:${item.sourceProductId}`}>
          <Card>
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">#{(page - 1) * pageSize + i + 1}</span>
                  <div className="min-w-0">
                    <Link to={`/products/${item.platform}/${encodeURIComponent(item.sourceProductId)}`} className="block truncate font-mono text-sm font-medium hover:underline">
                      {item.sourceProductId}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="capitalize">{item.platform}</span>
                      {item.brand && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.brand}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {sort === "health" && isHealthScore(item.data) ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Rating score</dt>
                    <dd className="font-medium tabular-nums">{item.data.ratingScore}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Trend score</dt>
                    <dd className="font-medium tabular-nums">{item.data.trendScore}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Severity</dt>
                    <dd className="font-medium text-muted-foreground">Not available</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Total</dt>
                    <dd className="font-medium text-muted-foreground">Not available</dd>
                  </div>
                </dl>
              ) : !isHealthScore(item.data) ? (
                <>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Average rating</dt>
                      <dd className="font-medium tabular-nums">{item.data.recentMetrics.averageRating ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Reviews</dt>
                      <dd className="font-medium tabular-nums">{item.data.recentMetrics.totalReviews}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(() => {
                      const t = TREND_CONFIG[item.data.trendDirection];
                      return <StatusBadge tone={t.tone} icon={t.icon} label={t.label} />;
                    })()}
                    <ConfidenceBadge value={item.data.recentMetrics.confidence} />
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
