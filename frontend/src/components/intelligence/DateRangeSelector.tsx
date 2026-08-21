import { useEffect, useState } from "react";

/**
 * Analysis date range for the ProductDetail dashboard.
 *
 * Replaces the fixed 7d/30d/60d/90d/6m/12m tabs on that page. Those six buckets
 * could not express "the week of the launch" or "since the packaging changed",
 * which is most of what anyone actually wants to look at. Defaults to the last
 * 30 days.
 *
 * Deliberately separate from WindowSelector rather than a replacement for it:
 * Dashboard, Products, Problems, BrandComparison and ProductComparison all still
 * use named windows, and widening this change to them was not asked for.
 *
 * Scope note: this controls the DASHBOARD panels only. It is NOT plumbed into
 * the AI Analyst — the analyst derives scope from the question, and inheriting a
 * dashboard filter is exactly what made "give me all the reviews" answer from a
 * 30-day slice (2 of 20 reviews).
 */

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return toIso(new Date());
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toIso(d);
}

/** The range the dashboard opens with. */
export const DEFAULT_RANGE_DAYS = 30;
export function defaultRange(): DateRange {
  return { from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() };
}

const PRESETS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "12m", days: 365 },
];

export function DateRangeSelector({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  // Local draft so typing a date does not fire a request per keystroke.
  const [draft, setDraft] = useState<DateRange>(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value.from, value.to]);

  const dirty = draft.from !== value.from || draft.to !== value.to;

  function applyPreset(days: number) {
    setError(null);
    onChange({ from: daysAgoIso(days), to: todayIso() });
  }

  function apply() {
    if (!draft.from || !draft.to) {
      setError("Pick both a start and an end date.");
      return;
    }
    if (draft.from > draft.to) {
      setError("Start date must be on or before the end date.");
      return;
    }
    setError(null);
    onChange(draft);
  }

  const today = todayIso();
  const activePreset = PRESETS.find((p) => value.to === today && value.from === daysAgoIso(p.days));

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.days)}
            aria-pressed={activePreset?.label === p.label}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activePreset?.label === p.label
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {p.label}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <label className="sr-only" htmlFor="range-from">Start date</label>
        <input
          id="range-from"
          type="date"
          value={draft.from}
          max={draft.to || today}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          style={{ colorScheme: "dark" }}
          className="px-2.5 py-1.5 rounded-md bg-muted text-foreground border border-border text-sm outline-none focus:border-primary transition-colors"
        />
        <span className="text-muted-foreground text-sm">to</span>
        <label className="sr-only" htmlFor="range-to">End date</label>
        <input
          id="range-to"
          type="date"
          value={draft.to}
          min={draft.from}
          max={today}
          onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          style={{ colorScheme: "dark" }}
          className="px-2.5 py-1.5 rounded-md bg-muted text-foreground border border-border text-sm outline-none focus:border-primary transition-colors"
        />

        <button
          type="button"
          onClick={apply}
          disabled={!dirty}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Apply
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
