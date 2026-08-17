import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Generic skeleton block. Announces itself to screen readers via
 * aria-busy on the wrapper so async loading isn't silent (§16 of the design doc). */
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
