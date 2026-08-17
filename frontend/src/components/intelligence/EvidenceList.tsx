import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders `evidenceReviewIds` as a citation list — never a bare claim (§12
 * of the design doc: every AI claim shows its evidence, or a count/affordance
 * for it). This app has no endpoint that resolves a canonical_review_id to
 * review content, so IDs are shown as opaque citation references, not
 * linked to review text that doesn't exist in this API surface.
 */
export function EvidenceList({ reviewIds, className }: { reviewIds: string[]; className?: string }) {
  if (reviewIds.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>No cited evidence.</p>;
  }
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {reviewIds.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          <FileText className="size-3" aria-hidden="true" />
          {id.slice(0, 8)}
        </span>
      ))}
    </div>
  );
}
