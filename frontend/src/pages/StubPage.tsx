/**
 * Phase 7 Step 1 — a shared placeholder shell for every page. Deliberately
 * NOT a real implementation (§19 of Step 1's instructions: "Do not fully
 * implement" any of the 9 pages this step). Each page below wraps this
 * with its own title/description/endpoint list so the routing, layout,
 * and auth foundation can be verified end-to-end without pre-building
 * page logic that a later, explicitly-approved step owns.
 */
export function StubPage({ title, description, endpoints }: { title: string; description: string; endpoints: string[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Not implemented yet — Phase 7 Step 1 is foundation only.</p>
        <p className="mt-2">This page will call:</p>
        <ul className="mt-1 list-inside list-disc font-mono text-xs">
          {endpoints.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
