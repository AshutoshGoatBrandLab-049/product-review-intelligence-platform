import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phase 8 Step 1 — the single shared visual primitive behind every status
 * badge in the app (ConfidenceBadge, SignalBadge, MarketplaceBadge,
 * SystemStatusBadge, and the System page's ingestion/AI-usage tables).
 * `tone` is a presentational choice only — it never encodes a business
 * meaning of its own (no "severity" tone exists here). Each caller decides
 * which real backend value maps to which tone; this component just
 * guarantees every badge in the app looks and behaves consistently once
 * that decision is made. Status is never communicated by color alone:
 * every tone is always paired with an icon and a text label.
 */
export type StatusTone = "success" | "warning" | "info" | "neutral" | "danger";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-bg text-success-fg border-success-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  info: "bg-info-bg text-info-fg border-info-border",
  neutral: "bg-muted text-muted-foreground border-border",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
};

export function StatusBadge({
  tone,
  icon: Icon,
  label,
  className,
}: {
  tone: StatusTone;
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TONE_CLASSES[tone], className)}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}
