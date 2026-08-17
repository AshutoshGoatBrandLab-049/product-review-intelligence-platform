import { Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EvidenceList } from "@/components/intelligence/EvidenceList";
import { RecommendationCard } from "./RecommendationCard";
import type { NarratorResult } from "@/types/api";

/**
 * The top-level AI insight surface for a product (§12/§14 of the design
 * doc). Every element here is visually distinct from deterministic
 * analytics (violet accent, "AI"-labeled) — never presented in the same
 * register as a HealthScore number. citedMetrics vs ungroundedMetrics is
 * shown as two explicitly different lists: this is the single most
 * load-bearing AI-trust signal Phase 4.1 built, and hiding either would
 * defeat its purpose.
 */
export function AIInsightCard({ insight }: { insight: NarratorResult }) {
  return (
    <div className="space-y-4">
      <Card className="border-violet-200 bg-violet-50/40">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Sparkles className="size-4 text-violet-600" aria-hidden="true" />
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-violet-700">AI Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">{insight.summary}</p>
          <p className="text-xs text-muted-foreground italic">
            This is AI-generated interpretation based on detected patterns in your data.
          </p>
        </CardContent>
      </Card>

      {insight.rootCause.length === 0 && insight.recommendations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No strong, evidence-backed finding for this period.</p>
      ) : (
        <>
          {insight.rootCause.map((entry, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm capitalize">{entry.theme.replace("_", " ")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">{entry.explanation}</p>
                <EvidenceList reviewIds={entry.evidenceReviewIds} />
              </CardContent>
            </Card>
          ))}
          {insight.recommendations.map((rec, i) => (
            <RecommendationCard key={i} recommendation={rec} />
          ))}
        </>
      )}

      {(insight.citedMetrics.length > 0 || insight.ungroundedMetrics.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Verification Status</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {insight.citedMetrics.length > 0 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
                <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  Grounded in Data
                </p>
                <ul className="space-y-0.5 text-xs text-emerald-800">
                  {insight.citedMetrics.map((m, i) => (
                    <li key={i} className="tabular-nums">
                      {m.field}: {m.statedValue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insight.ungroundedMetrics.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="mb-1.5 flex w-fit items-center gap-1 text-xs font-medium text-amber-700">
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      Not Verified
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>AI stated these metrics, but they do not match verified product data. Use with caution.</TooltipContent>
                </Tooltip>
                <ul className="space-y-0.5 text-xs text-amber-800">
                  {insight.ungroundedMetrics.map((m, i) => (
                    <li key={i} className="tabular-nums">
                      {m.field}: {m.statedValue} ({m.reason === "unknown_field" ? "unrecognized field" : "did not match real data"})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {insight.droppedUnsupportedClaims > 0 && (
        <p className="text-xs text-muted-foreground">
          {insight.droppedUnsupportedClaims} additional finding{insight.droppedUnsupportedClaims === 1 ? "" : "s"} filtered for lacking evidence.
        </p>
      )}
    </div>
  );
}
