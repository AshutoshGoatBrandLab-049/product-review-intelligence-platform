import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phase 8 Step 1 — the two shared visual registers behind every "there is
 * a real reason this isn't a normal data view" state in the app. Neither
 * of these decides what the reason IS — each caller (EmptyState,
 * NoMappingState, InsufficientDataState, NotReadyState) supplies its own
 * icon/copy for a real, distinct backend condition; this file only
 * guarantees they all share identical spacing/sizing/border treatment so
 * the app never has five slightly-different-looking versions of "nothing
 * to show here." Two registers, not one, because they serve genuinely
 * different roles: a Panel replaces an entire section/page's content, a
 * Notice sits inside an already-rendered card/section as a smaller aside.
 */

export function DashedStatePanel({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center", className)}>
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function DashedStateNotice({ icon: Icon, text, className }: { icon: LucideIcon; text: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground", className)}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
