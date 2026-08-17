import { Equal, CircleHelp, SplitSquareHorizontal } from "lucide-react";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { ThemeConsistencyClassification } from "@/types/api";

/**
 * Three real, distinct states (analytics/marketplaceComparison.ts) — never
 * collapsed into a binary. `marketplace_specific` in the real dataset today
 * is dominated by an upstream Myntra AI-coverage gap, not proven genuine
 * behavior (Phase 5 report §5) — callers that render real data should pair
 * this badge with that caveat where the context allows for it.
 *
 * Phase 8 Step 1 — moved onto the shared StatusBadge tone system.
 */
const CONFIG: Record<ThemeConsistencyClassification, { label: string; icon: typeof Equal; tone: StatusTone }> = {
  marketplace_consistent: { label: "Consistent across marketplaces", icon: Equal, tone: "success" },
  marketplace_specific: { label: "Marketplace-specific", icon: SplitSquareHorizontal, tone: "warning" },
  insufficient_evidence: { label: "Not enough data to compare", icon: CircleHelp, tone: "neutral" },
};

export function MarketplaceBadge({ value, className }: { value: ThemeConsistencyClassification; className?: string }) {
  const { label, icon, tone } = CONFIG[value];
  return <StatusBadge tone={tone} icon={icon} label={label} className={className} />;
}
