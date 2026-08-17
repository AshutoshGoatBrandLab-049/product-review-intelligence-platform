import type { EarlyWarningSignal } from "@/types/api";

export interface SplitSignals {
  active: EarlyWarningSignal[];
  /** Grouped by signalType with a count, not listed per-entry — a single
   * product can carry one not_ready entry (product_deterioration), but the
   * catalog-wide sweep this same shape is reused for (Dashboard) can carry
   * hundreds; grouping keeps both cases honest without ever being spammy. */
  notReadyGroups: Array<[signalType: string, count: number]>;
}

/**
 * Phase 7 Step 3 — extracted from Dashboard.tsx (Step 2) so Product Detail
 * can reuse the exact same not_ready/active split logic rather than
 * duplicating it. Pure function, no analytics computed — `confidence` is
 * already computed by the backend; this only groups by a value that's
 * already there.
 */
export function splitSignalsByReadiness(signals: EarlyWarningSignal[]): SplitSignals {
  const active: EarlyWarningSignal[] = [];
  const notReadyCounts = new Map<string, number>();
  for (const s of signals) {
    if (s.confidence === "not_ready") {
      notReadyCounts.set(s.signalType, (notReadyCounts.get(s.signalType) ?? 0) + 1);
    } else {
      active.push(s);
    }
  }
  return { active, notReadyGroups: [...notReadyCounts.entries()] };
}
