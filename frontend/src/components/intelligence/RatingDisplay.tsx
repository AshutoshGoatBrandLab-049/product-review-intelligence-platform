import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** `rating` is nullable (CoreMetrics.averageRating) — renders "No rating
 * data" rather than a fabricated star count. */
export function RatingDisplay({ rating, reviewCount, className }: { rating: number | null; reviewCount?: number; className?: string }) {
  if (rating === null) {
    return <span className={cn("text-sm text-muted-foreground", className)}>No rating data</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{rating.toFixed(2)}</span>
      {reviewCount !== undefined && <span className="text-sm text-muted-foreground">({reviewCount.toLocaleString()})</span>}
    </span>
  );
}
