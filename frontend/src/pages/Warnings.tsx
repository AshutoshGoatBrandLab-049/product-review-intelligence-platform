import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TriangleAlert, AlertCircle } from "lucide-react";
import { useEarlyWarnings } from "@/hooks/queries/useCategoryC";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { EarlyWarningCard } from "@/components/intelligence/EarlyWarningCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { splitSignalsByReadiness } from "@/lib/signals";
import type { NamedWindow, Platform, SignalType } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

function readPlatformParam(raw: string | null): Platform | undefined {
  return raw === "flipkart" || raw === "myntra" ? raw : undefined;
}

/**
 * Phase 8 Step 4 — Product Intelligence investigation surface for early
 * warnings. Every signal comes directly from GET /v1/early-warnings — this
 * page computes no delta/threshold/confidence/severity of its own.
 * `window`/`platform`/`brand` are the only three real backend-supported
 * filters (schemas.ts EarlyWarningsQuerySchema) and are sent to the API
 * exactly as-is; the signal-type filter is client-side grouping of
 * already-fetched signals, not a new analytics computation.
 */
export function Warnings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const window_ = readWindowParam(searchParams.get("window"));
  const platform = readPlatformParam(searchParams.get("platform"));
  const brandParam = searchParams.get("brand") ?? "";
  const signalTypeParam = searchParams.get("signalType");

  const [brandDraft, setBrandDraft] = useState(brandParam);

  function updateParams(next: Partial<{ window: NamedWindow; platform: Platform | ""; brand: string; signalType: string }>) {
    const params = new URLSearchParams(searchParams);
    if (next.window !== undefined) params.set("window", next.window);
    if (next.platform !== undefined) {
      if (next.platform) params.set("platform", next.platform);
      else params.delete("platform");
    }
    if (next.brand !== undefined) {
      if (next.brand) params.set("brand", next.brand);
      else params.delete("brand");
    }
    if (next.signalType !== undefined) {
      if (next.signalType) params.set("signalType", next.signalType);
      else params.delete("signalType");
    }
    setSearchParams(params, { replace: true });
  }

  const warningsQuery = useEarlyWarnings({ window: window_, platform, brand: brandParam || undefined });

  const { active: activeWarnings, notReadyGroups } = useMemo(
    () => splitSignalsByReadiness(warningsQuery.data?.signals ?? []),
    [warningsQuery.data],
  );

  const countsByType = useMemo(() => {
    const counts = new Map<SignalType, number>();
    for (const s of activeWarnings) counts.set(s.signalType, (counts.get(s.signalType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [activeWarnings]);

  const visibleWarnings = signalTypeParam ? activeWarnings.filter((s) => s.signalType === signalTypeParam) : activeWarnings;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Early Warnings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Catalog-wide investigation feed — which products need attention right now, and what's changed.
          </p>
        </div>
        <div className="shrink-0">
          <WindowSelector value={window_} onChange={(w) => updateParams({ window: w })} />
        </div>
      </div>

      {/* Filters section */}
      <section aria-labelledby="filters-heading" className="space-y-3 rounded-lg border border-dashed p-4">
        <h2 id="filters-heading" className="text-sm font-semibold">
          Filters
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Marketplace</p>
            <Tabs value={platform ?? "all"} onValueChange={(v) => updateParams({ platform: v === "all" ? "" : (v as Platform) })}>
              <TabsList aria-label="Filter by marketplace">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="flipkart">Flipkart</TabsTrigger>
                <TabsTrigger value="myntra">Myntra</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              updateParams({ brand: brandDraft.trim() });
            }}
          >
            <label htmlFor="brand-filter" className="text-xs font-medium text-muted-foreground">
              Brand (exact match)
            </label>
            <div className="flex gap-2">
              <Input
                id="brand-filter"
                value={brandDraft}
                onChange={(e) => setBrandDraft(e.target.value)}
                placeholder="e.g. Bluepeak"
                className="h-8 w-40"
              />
              <Button type="submit" size="sm" variant="outline">
                Apply
              </Button>
              {brandParam && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBrandDraft("");
                    updateParams({ brand: "" });
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>
        </div>
      </section>

      {warningsQuery.isError ? (
        <ErrorState error={warningsQuery.error} onRetry={() => warningsQuery.refetch()} />
      ) : warningsQuery.isPending ? (
        <LoadingState rows={6} />
      ) : (
        <>
          {/* Active warnings section */}
          <section aria-labelledby="active-warnings-heading" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="active-warnings-heading" className="text-sm font-semibold">
                Active Signals
              </h2>
              {activeWarnings.length > 0 && (
                <span className="inline-block rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                  {activeWarnings.length} {activeWarnings.length === 1 ? "signal" : "signals"} detected
                </span>
              )}
            </div>

            {/* Signal type filter — visible only when signals exist */}
            {countsByType.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Filter by signal type:</p>
                <Tabs value={signalTypeParam ?? "all"} onValueChange={(v) => updateParams({ signalType: v === "all" ? "" : v })}>
                  <TabsList aria-label="Filter by signal type" className="h-auto flex-wrap">
                    <TabsTrigger value="all">All ({activeWarnings.length})</TabsTrigger>
                    {countsByType.map(([type, count]) => (
                      <TabsTrigger key={type} value={type}>
                        {type.replace(/_/g, " ")} ({count})
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}

            {/* Warnings grid or empty state */}
            {activeWarnings.length === 0 ? (
              <EmptyState
                title="No active warnings for this period"
                description="This is a real analytical result, not an error."
                icon={TriangleAlert}
              />
            ) : visibleWarnings.length === 0 ? (
              <EmptyState title="No warnings match this signal type" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleWarnings.map((s, i) => (
                  <EarlyWarningCard key={`${s.platform}:${s.sourceProductId}:${s.signalType}:${i}`} signal={s} />
                ))}
              </div>
            )}
          </section>

          {/* Not Available Yet section */}
          {notReadyGroups.length > 0 && (
            <section aria-labelledby="not-available-heading" className="space-y-3">
              <h2 id="not-available-heading" className="text-sm font-semibold">
                Not Available Yet
              </h2>
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p className="font-medium">
                        {notReadyGroups.length} signal {notReadyGroups.length === 1 ? "type" : "types"} not currently available
                      </p>
                      <ul className="space-y-1">
                        {notReadyGroups.map(([signalType, count]) => (
                          <li key={signalType}>
                            <span className="capitalize">{signalType.replace(/_/g, " ")}</span> — checked {count} product
                            {count === 1 ? "" : "s"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
