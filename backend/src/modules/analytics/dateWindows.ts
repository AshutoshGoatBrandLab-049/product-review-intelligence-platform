/**
 * Phase 3 §2/§3 — the single chokepoint for constructing a business date
 * window. Every analytics function takes a DateWindow, never a bare number
 * of days — nothing outside this file computes a window boundary by hand.
 *
 * Business date rule (absolute, per Phase 3 approval): windows are always
 * built from review_date. This module never reads updatedAt, source_updated_at,
 * created_at, or ingested_at — it doesn't touch the database at all, it only
 * computes plain date strings.
 */

export type NamedWindow = "7d" | "30d" | "60d" | "90d" | "6m" | "12m";

export interface DateWindow {
  /** YYYY-MM-DD, inclusive */
  start: string;
  /** YYYY-MM-DD, inclusive */
  end: string;
}

const NAMED_WINDOW_DAYS: Record<"7d" | "30d" | "60d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

function isValidDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function todayDateOnly(): string {
  return toDateOnly(new Date());
}

/**
 * Resolves a named window ending on `asOf` (defaults to today, but always an
 * explicit parameter — never a bare `new Date()` buried inside a query
 * function — so tests can pin it deterministically instead of depending on
 * wall-clock time).
 */
export function resolveNamedWindow(window: NamedWindow, asOf: string = todayDateOnly()): DateWindow {
  if (!isValidDateOnly(asOf)) {
    throw new Error(`resolveNamedWindow: invalid asOf date "${asOf}"`);
  }

  const end = asOf;
  const start = parseDateOnly(asOf);

  if (window === "6m") {
    start.setUTCMonth(start.getUTCMonth() - 6);
    start.setUTCDate(start.getUTCDate() + 1); // inclusive end -> start is day after the 6-month-back anchor
  } else if (window === "12m") {
    start.setUTCMonth(start.getUTCMonth() - 12);
    start.setUTCDate(start.getUTCDate() + 1);
  } else {
    const days = NAMED_WINDOW_DAYS[window];
    start.setUTCDate(start.getUTCDate() - (days - 1));
  }

  return { start: toDateOnly(start), end };
}

/** Arbitrary custom range — validated, never silently accepted if inverted. */
export function customWindow(start: string, end: string): DateWindow {
  if (!isValidDateOnly(start) || !isValidDateOnly(end)) {
    throw new Error(`customWindow: invalid date(s) start="${start}" end="${end}"`);
  }
  if (start > end) {
    throw new Error(`customWindow: start (${start}) must not be after end (${end})`);
  }
  return { start, end };
}

function windowLengthDays(window: DateWindow): number {
  const ms = parseDateOnly(window.end).getTime() - parseDateOnly(window.start).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1; // inclusive on both ends
}

/**
 * The previous period is the immediately preceding window of identical
 * length, ending the day before the current window starts (Phase 3 §4,
 * approved comparison rule — the only comparison rule this module
 * implements; "previous 90-day period" and "historical baseline" are this
 * same function called with a different window, not separate logic).
 */
export function previousEquivalentWindow(window: DateWindow): DateWindow {
  const lengthDays = windowLengthDays(window);
  const previousEnd = parseDateOnly(window.start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (lengthDays - 1));
  return { start: toDateOnly(previousStart), end: toDateOnly(previousEnd) };
}

export function daysInWindow(window: DateWindow): number {
  return windowLengthDays(window);
}
