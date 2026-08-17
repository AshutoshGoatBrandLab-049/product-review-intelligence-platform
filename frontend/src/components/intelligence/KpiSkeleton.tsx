import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Matches MetricCard's real layout so the loading state doesn't visually
 * jump when real data arrives (§13 of the Step 2 spec). */
export function KpiSkeleton() {
  return (
    <Card role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16" />
      </CardContent>
    </Card>
  );
}
