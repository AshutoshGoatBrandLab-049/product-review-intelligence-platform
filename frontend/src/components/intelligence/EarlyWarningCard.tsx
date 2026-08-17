import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { SignalBadge } from "./SignalBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { EarlyWarningSignal } from "@/types/api";

/**
 * §9 of the Step 2 spec: current/baseline/delta/threshold/confidence/
 * evidence count — exactly the real EarlyWarningSignal fields, nothing
 * invented. EarlyWarningSignal has no severity field at all, so none is
 * displayed or derived here.
 */
export function EarlyWarningCard({ signal }: { signal: EarlyWarningSignal }) {
  return (
    <Link
      to={`/products/${signal.platform}/${encodeURIComponent(signal.sourceProductId)}`}
      className="block rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="border-0 p-0 shadow-none">
        <CardContent className="space-y-2 p-0">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge signalType={signal.signalType} />
            <ConfidenceBadge value={signal.confidence} />
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {signal.platform} · {signal.sourceProductId}
            </span>
          </div>
          <dl className="grid grid-cols-4 gap-x-3 gap-y-1 text-xs">
            <div>
              <dt className="text-muted-foreground">Current</dt>
              <dd className="font-medium tabular-nums">{signal.currentMetric}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Baseline</dt>
              <dd className="font-medium tabular-nums">{signal.baselineMetric}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Delta</dt>
              <dd className="font-medium tabular-nums">{signal.delta}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Threshold</dt>
              <dd className="font-medium tabular-nums">{signal.threshold}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{signal.evidenceReviewIds.length} cited review(s)</p>
        </CardContent>
      </Card>
    </Link>
  );
}
