import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A single KPI. `value` accepts `null` explicitly and renders it as
 * "—" — never coerced to 0 (§4/§11 of the design doc: averageRatingScore,
 * severityScore, etc. are all real nullable backend fields).
 *
 * Phase 8 Step 1 — the concrete "metric"/"metric label" tier of the
 * typography hierarchy (Step 0 audit §17): the label is now a small
 * uppercase eyebrow (matching how the rest of the command-center reads
 * dense data), the value stays the largest number on the page. Purely a
 * visual change — same props, same null-handling, same DOM text content.
 *
 * Phase 8 Step 2 — added an opt-in `size="lg"` variant so a caller can
 * give one genuinely primary metric more visual weight than its siblings
 * (Step 2's "avoid equal visual weight" requirement) without every
 * existing MetricCard caller changing appearance — `size` defaults to
 * "default", identical to every card before this step.
 */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  size = "default",
  className,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  icon?: ReactNode;
  size?: "default" | "lg";
  className?: string;
}) {
  return (
    <Card className={cn(size === "lg" && "ring-1 ring-primary/15", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={cn("font-semibold tabular-nums", size === "lg" ? "text-4xl" : "text-2xl")}>{value === null ? "—" : value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
