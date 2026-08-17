import { CircleAlert, CircleCheck, CircleDashed, CircleHelp } from "lucide-react";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { ConfidenceLevel } from "@/types/api";

/**
 * Phase 7 Step 1 — a status token, not a Badge variant swap: color + icon +
 * text, per the design doc's §12/§16 rule that status is never
 * color-only (colorblind users must still be able to tell these apart).
 * `not_ready` is a distinct real backend state (product_deterioration,
 * complaint_spike without a threshold) — never merged with
 * `insufficient_data`, which means something different (not enough sample).
 *
 * Phase 8 Step 1 — now a thin mapping onto the shared StatusBadge tone
 * system (token-based, dark-mode-correct) instead of its own hardcoded
 * literal colors. The mapping is presentational only: `medium` reading as
 * "info" tone rather than "success" is a visual choice, not a claim that
 * medium confidence is somehow less real than high confidence.
 */
export type ConfidenceBadgeValue = ConfidenceLevel | "not_ready";

const CONFIG: Record<ConfidenceBadgeValue, { label: string; icon: typeof CircleCheck; tone: StatusTone }> = {
  high: { label: "High confidence", icon: CircleCheck, tone: "success" },
  medium: { label: "Medium confidence", icon: CircleCheck, tone: "info" },
  low: { label: "Low confidence", icon: CircleAlert, tone: "warning" },
  insufficient_data: { label: "Not enough data", icon: CircleHelp, tone: "neutral" },
  not_ready: { label: "Not available", icon: CircleDashed, tone: "neutral" },
};

export function ConfidenceBadge({ value, className }: { value: ConfidenceBadgeValue; className?: string }) {
  const { label, icon, tone } = CONFIG[value];
  return <StatusBadge tone={tone} icon={icon} label={label} className={className} />;
}
