/**
 * Phase 10 query-understanding correction — deterministic timeframe parsing.
 *
 * Root cause fixed here: neither `detectIntent()` nor `detectWindowFromQuestion()`
 * in productAnalyst.ts could recognize an arbitrary "last N days" expression —
 * detectWindowFromQuestion() only literal-matched the fixed set 7/30/60/90/180/365,
 * so "last 5 days" (or any N outside that set) was structurally invisible. This
 * module is the single place a free-text timeframe expression is turned into a
 * real, deterministic DateWindow — the LLM never invents or approximates one.
 *
 * CONVENTION (must match dateWindows.ts's existing "Nd" semantics, not invent a
 * new one): resolveNamedWindow("7d") resolves to `[asOf - 6 days, asOf]` — 7
 * calendar days, inclusive of "today" on both ends. "Last N days" here follows
 * the exact same rule: `start = asOf - (N - 1) days`, `end = asOf`. So "last 5
 * days" = today plus the previous 4 calendar days (5 days total), NOT a rolling
 * 5×24h window. This is a deliberate choice to stay consistent with the one
 * date-window convention this codebase already has, not a new one.
 */

import { customWindow, type DateWindow } from "../analytics/dateWindows.js";

export type TimeframeType = "RELATIVE" | "ABSOLUTE" | "NAMED";
export type TimeframeUnit = "day" | "week" | "month" | "year";

export interface ResolvedTimeframe {
  type: TimeframeType;
  unit?: TimeframeUnit;
  value?: number;
  /** The real, deterministic DateWindow to query normalized_reviews with. */
  window: DateWindow;
  /** The substring of the original question that was matched, for debugging/logging. */
  raw: string;
  /** True only for ABSOLUTE ranges that could not be parsed — window falls back to caller's default. */
  unparseable?: boolean;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** N calendar days ending on `asOf`, inclusive both ends — the same rule as resolveNamedWindow("Nd"). */
export function lastNDays(n: number, asOf: string): DateWindow {
  const end = asOf;
  const start = parseDateOnly(asOf);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  return { start: toDateOnly(start), end };
}

export function lastNMonths(n: number, asOf: string): DateWindow {
  const end = asOf;
  const start = parseDateOnly(asOf);
  start.setUTCMonth(start.getUTCMonth() - n);
  start.setUTCDate(start.getUTCDate() + 1);
  return { start: toDateOnly(start), end };
}

const UNIT_WORD_TO_UNIT: Record<string, TimeframeUnit> = {
  day: "day",
  days: "day",
  din: "day",
  dino: "day",
  week: "week",
  weeks: "week",
  hafta: "week",
  hafte: "week",
  month: "month",
  months: "month",
  mahina: "month",
  mahine: "month",
  year: "year",
  years: "year",
  saal: "year",
};

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export function windowFromUnitValue(unit: TimeframeUnit, value: number, asOf: string): DateWindow {
  switch (unit) {
    case "day":
      return lastNDays(value, asOf);
    case "week":
      return lastNDays(value * 7, asOf);
    case "month":
      return lastNMonths(value, asOf);
    case "year":
      return lastNMonths(value * 12, asOf);
  }
}

/**
 * Attempts a best-effort parse of an absolute date range expression such as
 * "from Aug 1 to Aug 10" / "between 1 Aug and 10 Aug". Returns null if the
 * text contains no recognizable absolute-range marker at all (so callers can
 * fall through to other timeframe checks); returns `unparseable: true` if a
 * range marker WAS present but the dates inside it could not be parsed — the
 * spec requires this be surfaced, not silently dropped.
 */
function tryParseAbsoluteRange(question: string, asOf: string): ResolvedTimeframe | null {
  const rangeMatch = question.match(
    /\b(?:from|between)\s+([a-z0-9 ,]+?)\s+(?:to|and|-)\s+([a-z0-9 ,]+?)(?:[.?!]|$)/i,
  );
  if (!rangeMatch) return null;

  const year = parseDateOnly(asOf).getUTCFullYear();
  const parseOneDate = (text: string): string | null => {
    const m = text
      .trim()
      .toLowerCase()
      .match(/^(?:(\d{1,2})\s+)?([a-z]+)\s*(\d{1,2})?(?:,?\s*(\d{4}))?$/) ??
      text.trim().toLowerCase().match(/^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
    if (!m) return null;
    let day: number | undefined;
    let monthWord: string | undefined;
    let y = year;
    if (m.length === 5 && m[2] && MONTH_NAMES[m[2]] !== undefined) {
      // "1 Aug" / "1 Aug 2026" form
      day = m[1] ? parseInt(m[1], 10) : m[3] ? parseInt(m[3], 10) : undefined;
      monthWord = m[2];
      if (m[4]) y = parseInt(m[4], 10);
    } else if (m[1] && MONTH_NAMES[m[1]] !== undefined) {
      // "Aug 1" / "Aug 1, 2026" form
      monthWord = m[1];
      day = m[2] ? parseInt(m[2], 10) : undefined;
      if (m[3]) y = parseInt(m[3], 10);
    }
    if (!monthWord || day === undefined || MONTH_NAMES[monthWord] === undefined) return null;
    const month = MONTH_NAMES[monthWord];
    const d = new Date(Date.UTC(y, month, day));
    if (Number.isNaN(d.getTime())) return null;
    return toDateOnly(d);
  };

  const start = parseOneDate(rangeMatch[1] ?? "");
  const end = parseOneDate(rangeMatch[2] ?? "");

  if (!start || !end) {
    return {
      type: "ABSOLUTE",
      window: { start: asOf, end: asOf },
      raw: rangeMatch[0],
      unparseable: true,
    };
  }

  try {
    const window = start <= end ? customWindow(start, end) : customWindow(end, start);
    return { type: "ABSOLUTE", window, raw: rangeMatch[0] };
  } catch {
    return { type: "ABSOLUTE", window: { start: asOf, end: asOf }, raw: rangeMatch[0], unparseable: true };
  }
}

/**
 * Resolves a concrete timeframe expression from free text, if one is present.
 * Returns null when no concrete timeframe was expressed — "recent"/"latest"
 * alone must NOT force a timeframe filter (per spec), so they are
 * deliberately not matched here.
 */
export function resolveTimeframeFromQuestion(question: string, asOf: string = new Date().toISOString().slice(0, 10)): ResolvedTimeframe | null {
  const q = question.toLowerCase();

  // Absolute range takes precedence when present.
  const absolute = tryParseAbsoluteRange(q, asOf);
  if (absolute) return absolute;

  // Hindi/Hinglish named-day expressions.
  if (/\bkal\s+ke\b|\bkal\s+ki\b|\bkal\s+ka\b/.test(q) && !/\bparso?n\b/.test(q)) {
    // "kal ke reviews" (yesterday's reviews)
    const y = parseDateOnly(asOf);
    y.setUTCDate(y.getUTCDate() - 1);
    const d = toDateOnly(y);
    return { type: "NAMED", unit: "day", value: 1, window: { start: d, end: d }, raw: "kal" };
  }
  if (/\baaj\s+ke\b|\baaj\s+ki\b|\baaj\s+ka\b/.test(q)) {
    return { type: "NAMED", unit: "day", value: 1, window: { start: asOf, end: asOf }, raw: "aaj" };
  }

  // English named-day expressions.
  if (/\byesterday\b/.test(q)) {
    const y = parseDateOnly(asOf);
    y.setUTCDate(y.getUTCDate() - 1);
    const d = toDateOnly(y);
    return { type: "NAMED", unit: "day", value: 1, window: { start: d, end: d }, raw: "yesterday" };
  }
  if (/\btoday\b/.test(q)) {
    return { type: "NAMED", unit: "day", value: 1, window: { start: asOf, end: asOf }, raw: "today" };
  }

  // Relative N-unit — English AND Hinglish, arbitrary N (not a fixed set).
  // Covers "last N days/weeks/months", "past N days", "previous N days",
  // "N din ke"/"pichhle N din"/"last N din".
  const relative = q.match(
    /\b(?:last|past|previous|pichhle|pichle|pichli|pichla)\s+(\d+)\s*(day|days|din|dino|week|weeks|hafta|hafte|month|months|mahina|mahine|year|years|saal)\b/,
  ) ?? q.match(/\b(\d+)\s*(day|days|din|dino|week|weeks|hafta|hafte|month|months|mahina|mahine|year|years|saal)\s+ke\b/);
  if (relative && relative[1] && relative[2]) {
    const value = parseInt(relative[1], 10);
    const unit = UNIT_WORD_TO_UNIT[relative[2]];
    if (unit && value > 0) {
      return { type: "RELATIVE", unit, value, window: windowFromUnitValue(unit, value, asOf), raw: relative[0] };
    }
  }

  // Named relative periods with an implied count.
  if (/\b(?:last|past)\s+week\b/.test(q)) {
    return { type: "NAMED", unit: "week", value: 1, window: lastNDays(7, asOf), raw: "last week" };
  }
  if (/\bthis\s+month\b/.test(q)) {
    const start = parseDateOnly(asOf);
    start.setUTCDate(1);
    return { type: "NAMED", unit: "month", value: 1, window: { start: toDateOnly(start), end: asOf }, raw: "this month" };
  }
  if (/\blast\s+month\b/.test(q)) {
    const firstOfThisMonth = parseDateOnly(asOf);
    firstOfThisMonth.setUTCDate(1);
    const lastOfPrevMonth = new Date(firstOfThisMonth);
    lastOfPrevMonth.setUTCDate(0);
    const firstOfPrevMonth = new Date(lastOfPrevMonth);
    firstOfPrevMonth.setUTCDate(1);
    return {
      type: "NAMED",
      unit: "month",
      value: 1,
      window: { start: toDateOnly(firstOfPrevMonth), end: toDateOnly(lastOfPrevMonth) },
      raw: "last month",
    };
  }

  // "recent"/"latest" alone deliberately NOT matched — no concrete unit given,
  // so no timeframe constraint is forced; the caller's existing default window applies.
  return null;
}

/**
 * Phase 10 semantic-query-understanding — the SEMANTIC descriptor an LLM
 * returns for a timeframe expression ("last 5 days", "yesterday", an
 * absolute range). The LLM outputs only this shape — a type + a small set of
 * scalar fields — never a computed DateWindow itself. All actual date
 * arithmetic happens below, in resolveTimeframeDescriptor(), reusing the
 * exact same deterministic helpers (lastNDays/lastNMonths/windowFromUnitValue/
 * customWindow) resolveTimeframeFromQuestion() above already uses. The model
 * decides WHAT the user meant; the backend decides WHAT DATE that is.
 */
export interface TimeframeDescriptor {
  type: TimeframeType | "NONE";
  value?: number | null;
  unit?: TimeframeUnit | null;
  /** ISO date (YYYY-MM-DD), for ABSOLUTE only. */
  start?: string | null;
  end?: string | null;
  /** For NAMED only — one of "yesterday" | "today" | "last_week" | "this_month" | "last_month". */
  name?: string | null;
}

/**
 * Deterministic conversion of a semantic timeframe descriptor into a real
 * DateWindow. This is the ONLY place a descriptor coming from an LLM call is
 * turned into dates actually used to query normalized_reviews — never trust
 * a date the model might have computed itself, because it never computes
 * one; it only names a type/unit/value/named-period.
 */
export function resolveTimeframeDescriptor(
  descriptor: TimeframeDescriptor,
  asOf: string = new Date().toISOString().slice(0, 10),
): ResolvedTimeframe | null {
  switch (descriptor.type) {
    case "NONE":
      return null;

    case "RELATIVE": {
      if (!descriptor.value || descriptor.value <= 0 || !descriptor.unit) return null;
      return {
        type: "RELATIVE",
        unit: descriptor.unit,
        value: descriptor.value,
        window: windowFromUnitValue(descriptor.unit, descriptor.value, asOf),
        raw: `${descriptor.value} ${descriptor.unit}(s)`,
      };
    }

    case "ABSOLUTE": {
      if (!descriptor.start || !descriptor.end) {
        return { type: "ABSOLUTE", window: { start: asOf, end: asOf }, raw: "absolute-range", unparseable: true };
      }
      try {
        const window =
          descriptor.start <= descriptor.end
            ? customWindow(descriptor.start, descriptor.end)
            : customWindow(descriptor.end, descriptor.start);
        return { type: "ABSOLUTE", window, raw: `${descriptor.start}..${descriptor.end}` };
      } catch {
        return {
          type: "ABSOLUTE",
          window: { start: asOf, end: asOf },
          raw: `${descriptor.start}..${descriptor.end}`,
          unparseable: true,
        };
      }
    }

    case "NAMED": {
      const name = (descriptor.name ?? "").toLowerCase().trim();
      if (name === "yesterday" || name === "kal") {
        const y = parseDateOnly(asOf);
        y.setUTCDate(y.getUTCDate() - 1);
        const d = toDateOnly(y);
        return { type: "NAMED", unit: "day", value: 1, window: { start: d, end: d }, raw: name };
      }
      if (name === "today" || name === "aaj") {
        return { type: "NAMED", unit: "day", value: 1, window: { start: asOf, end: asOf }, raw: name };
      }
      if (name === "last_week" || name === "this_week") {
        return { type: "NAMED", unit: "week", value: 1, window: lastNDays(7, asOf), raw: name };
      }
      if (name === "this_month") {
        const start = parseDateOnly(asOf);
        start.setUTCDate(1);
        return { type: "NAMED", unit: "month", value: 1, window: { start: toDateOnly(start), end: asOf }, raw: name };
      }
      if (name === "last_month") {
        const firstOfThisMonth = parseDateOnly(asOf);
        firstOfThisMonth.setUTCDate(1);
        const lastOfPrevMonth = new Date(firstOfThisMonth);
        lastOfPrevMonth.setUTCDate(0);
        const firstOfPrevMonth = new Date(lastOfPrevMonth);
        firstOfPrevMonth.setUTCDate(1);
        return {
          type: "NAMED",
          unit: "month",
          value: 1,
          window: { start: toDateOnly(firstOfPrevMonth), end: toDateOnly(lastOfPrevMonth) },
          raw: name,
        };
      }
      // Unrecognized named value from the model — degrade to "no timeframe
      // constraint" rather than guess a date range that wasn't named.
      return null;
    }

    default:
      return null;
  }
}
