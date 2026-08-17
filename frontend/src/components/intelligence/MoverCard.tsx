import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import type { HealthScore, Platform } from "@/types/api";

export interface MoverEntry {
  platform: Platform;
  sourceProductId: string;
  brand: string | null;
  health: HealthScore;
}

/**
 * Shared row for both Top Movers and Bottom Movers (§5/§6 of the Step 2
 * spec — identical principles, distinguished only by which list a caller
 * passes in). Renders exactly the HealthScore fields the backend computed
 * — ratingScore/trendScore are real numbers, severityScore/totalScore are
 * ALWAYS null (no approved formula) and render as "Not available", never a
 * fabricated 0 and never a derived severity. Confidence comes from the
 * per-product analytics the mover is not carrying directly here — the
 * dashboard endpoint's topMovers/bottomMovers entries only carry `health`,
 * which has no confidence field of its own (HealthScore is a formula
 * output, not a sampled metric) — so this card shows the two real,
 * non-null scores plainly and links through to Product Detail for the
 * full confidence-qualified picture. No confidence badge is shown here for
 * that reason — showing one would mean inventing a value the API never
 * returned for this specific entry.
 */
export function MoverCard({ entry }: { entry: MoverEntry }) {
  return (
    <Link
      to={`/products/${entry.platform}/${encodeURIComponent(entry.sourceProductId)}`}
      className="block rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="border-0 p-0 shadow-none">
        <CardContent className="space-y-2 p-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{entry.brand ?? "Unknown brand"}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {entry.platform} · {entry.sourceProductId}
              </p>
            </div>
            <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
              {entry.platform}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div>
              <dt className="text-muted-foreground">Rating score</dt>
              <dd className="font-medium tabular-nums">{entry.health.ratingScore}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trend score</dt>
              <dd className="font-medium tabular-nums">{entry.health.trendScore}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sentiment score</dt>
              <dd className="font-medium tabular-nums">{entry.health.sentimentScore ?? "Not available"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Complaint score</dt>
              <dd className="font-medium tabular-nums">{entry.health.complaintScore ?? "Not available"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Severity score</dt>
              <dd className="font-medium text-muted-foreground">Not available</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total score</dt>
              <dd className="font-medium text-muted-foreground">Not available</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
