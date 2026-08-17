import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus, CircleHelp } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
 * Phase 7 Step 4 / Phase 8 Step 3 — renders exactly what
 * GET /v1/products/rankings returns. Columns depend on `sort`: sort=health
 * shows HealthScore's real fields (severityScore/totalScore always "Not
 * available" — never fabricated, never derived; trendScore is shown as
 * the backend's own 0-100 number, with a static explanatory tooltip, never
 * a computed "improving/declining" label — deriving that from the raw
 * number would itself be a forbidden client-side trend calculation);
 * sort=rating shows ProductAnalytics's real fields (averageRating,
 * totalReviews, confidence, and — new this step — the real backend-
 * provided `trendDirection` enum, badged 1:1 with no client-side
 * inference). A row with `sortValue: null` (insufficient data to rank) is
 * still rendered, never hidden — it just sorts last, exactly as the
 * backend already ordered it. The backend always sorts its chosen metric
 * descending (rankings.ts's own comparator) — `aria-sort="descending"` on
 * that column is an honest statement of the real, already-true order, not
 * an interactive/clickable sort control (sort mode itself is chosen via
 * the page's Sort tabs, not by clicking a column header).
 */
export function RankingsTable({ items, sort }: { items: RankingsResponseItem[]; sort: RankingsSort }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          {sort === "health" ? (
            <>
              <TableHead className="text-right" aria-sort="descending">
                Rating score
              </TableHead>
              <TableHead className="text-right">
                <Tooltip>
                  <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">Trend score</TooltipTrigger>
                  <TooltipContent>0-100 scale, centered at 50 — 50 means no change from the prior period.</TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-right">Severity</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </>
          ) : (
            <>
              <TableHead className="text-right" aria-sort="descending">
                Average rating
              </TableHead>
              <TableHead className="text-right">Reviews</TableHead>
              <TableHead>Trend</TableHead>
              <TableHead>Confidence</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={`${item.platform}:${item.sourceProductId}`}>
            <TableCell>
              <Link
                to={`/products/${item.platform}/${encodeURIComponent(item.sourceProductId)}`}
                className="block font-mono text-sm font-medium hover:underline"
              >
                {item.sourceProductId}
              </Link>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="capitalize">{item.platform}</span>
                {item.brand && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{item.brand}</span>
                  </>
                )}
              </div>
            </TableCell>
            {sort === "health" && isHealthScore(item.data) ? (
              <>
                <TableCell className="text-right tabular-nums">{item.data.ratingScore}</TableCell>
                <TableCell className="text-right tabular-nums">{item.data.trendScore}</TableCell>
                <TableCell className="text-right text-muted-foreground">Not available</TableCell>
                <TableCell className="text-right text-muted-foreground">Not available</TableCell>
              </>
            ) : !isHealthScore(item.data) ? (
              <>
                <TableCell className="text-right tabular-nums">{item.data.recentMetrics.averageRating ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{item.data.recentMetrics.totalReviews}</TableCell>
                <TableCell>
                  {(() => {
                    const t = TREND_CONFIG[item.data.trendDirection];
                    return <StatusBadge tone={t.tone} icon={t.icon} label={t.label} />;
                  })()}
                </TableCell>
                <TableCell>
                  <ConfidenceBadge value={item.data.recentMetrics.confidence} />
                </TableCell>
              </>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
