/**
 * Phase 3 §4 — period comparison. One function, reused for every "current vs
 * previous" comparison in the analytics layer (product trend, brand trend,
 * platform trend) — never a separately reimplemented percentage-change
 * calculation elsewhere.
 */
export interface PeriodComparison {
  current: number;
  previous: number;
  absoluteDelta: number;
  /** null (never Infinity/NaN) when there's no prior baseline to compare against. */
  percentageDelta: number | null;
}

export function comparePeriods(current: number, previous: number): PeriodComparison {
  const absoluteDelta = current - previous;

  let percentageDelta: number | null;
  if (previous === 0) {
    // Approved rule: previous=0,current=0 -> 0%; previous=0,current>0 -> null
    // (insufficient prior data) — never Infinity, never NaN.
    percentageDelta = current === 0 ? 0 : null;
  } else {
    percentageDelta = (absoluteDelta / previous) * 100;
  }

  return { current, previous, absoluteDelta, percentageDelta };
}
