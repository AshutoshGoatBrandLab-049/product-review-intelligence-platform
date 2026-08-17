import { cn } from "@/lib/utils";

export interface ThemeListEntry {
  theme: string;
  count: number;
}

/** Ranked categorical frequency (topThemes/topNegativeThemes, problems
 * endpoint's `themes[]`) — a horizontal bar-per-row list, not a chart
 * library component, since it's simple ranked counts. */
export function ThemeList({ entries, className }: { entries: ThemeListEntry[]; className?: string }) {
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map((e) => e.count));

  return (
    <ul className={cn("space-y-1.5", className)}>
      {entries.map((entry) => (
        <li key={entry.theme} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate capitalize">{entry.theme.replace("_", " ")}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${max === 0 ? 0 : (entry.count / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}
