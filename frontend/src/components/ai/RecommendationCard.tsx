import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EvidenceList } from "@/components/intelligence/EvidenceList";
import type { NarratorRecommendationEntry } from "@/types/api";

/**
 * A recommendation is a model-generated suggestion, never a directive or a
 * guarantee (§12 of the design doc) — `confidence` (0-1, already computed
 * by the backend) is always shown alongside it, and the card carries a
 * persistent "AI" marker distinct from deterministic analytics cards.
 */
export function RecommendationCard({ recommendation }: { recommendation: NarratorRecommendationEntry }) {
  return (
    <Card className="border-violet-200 bg-violet-50/40">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Sparkles className="size-4 text-violet-600" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">AI recommendation</span>
        <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium tabular-nums text-violet-700">
          {Math.round(recommendation.confidence * 100)}% confidence
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm">{recommendation.reason}</p>
        {recommendation.theme && <p className="text-xs text-muted-foreground">Related theme: {recommendation.theme.replace("_", " ")}</p>}
        <EvidenceList reviewIds={recommendation.evidenceReviewIds} />
      </CardContent>
    </Card>
  );
}
