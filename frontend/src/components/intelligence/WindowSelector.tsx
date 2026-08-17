import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { NamedWindow } from "@/types/api";

/** The exact 6 windows the backend actually supports (schemas.ts
 * NamedWindowSchema) — never an invented option. */
const WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];

export function WindowSelector({ value, onChange }: { value: NamedWindow; onChange: (window: NamedWindow) => void }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as NamedWindow)}>
      <TabsList aria-label="Analysis window">
        {WINDOWS.map((w) => (
          <TabsTrigger key={w} value={w}>
            {w}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
