import { TrendingDown, MessageSquareWarning, ArrowUpRight, ActivitySquare, CircleDashed } from "lucide-react";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { SignalType } from "@/types/api";

/**
 * EarlyWarningSignal has no severity/priority field (analytics/earlyWarning.ts)
 * — this badge labels WHICH signal fired, it does not rank it. Any
 * emphasis ordering belongs to the caller (e.g. sorted by delta), not
 * fabricated here.
 *
 * Phase 8 Step 1 — moved onto the shared StatusBadge tone system. Every
 * real, fireable signal type shares one tone ("warning" — something needs
 * attention, not ranked against any other signal), resolving the previous
 * one-off orange hue that didn't belong to the app's semantic vocabulary
 * anywhere else. `product_deterioration` (permanently not_ready) stays on
 * the same "neutral" tone every other not-ready/unavailable state uses.
 */
const CONFIG: Record<SignalType, { label: string; icon: typeof TrendingDown; tone: StatusTone }> = {
  sudden_rating_decline: { label: "Rating decline", icon: TrendingDown, tone: "warning" },
  sudden_negative_review_increase: { label: "Negative review increase", icon: MessageSquareWarning, tone: "warning" },
  complaint_spike: { label: "Complaint spike", icon: MessageSquareWarning, tone: "warning" },
  review_volume_spike: { label: "Volume spike", icon: ArrowUpRight, tone: "warning" },
  persistent_negative_trend: { label: "Persistent negative trend", icon: ActivitySquare, tone: "warning" },
  product_deterioration: { label: "Deterioration (not available)", icon: CircleDashed, tone: "neutral" },
};

export function SignalBadge({ signalType, className }: { signalType: SignalType; className?: string }) {
  const { label, icon, tone } = CONFIG[signalType];
  return <StatusBadge tone={tone} icon={icon} label={label} className={className} />;
}
