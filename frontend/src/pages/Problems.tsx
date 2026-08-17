import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { InfoIcon, MessagesSquare } from "lucide-react";
import { useProblems } from "@/hooks/queries/useCategoryC";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { ProblemsTable } from "@/components/intelligence/ProblemsTable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { THEME_VOCABULARY } from "@/types/api";
import type { NamedWindow, Platform, Theme } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

function readPlatformParam(raw: string | null): Platform | undefined {
  return raw === "flipkart" || raw === "myntra" ? raw : undefined;
}

function readThemeParam(raw: string | null): Theme | undefined {
  return (THEME_VOCABULARY as readonly string[]).includes(raw ?? "") ? (raw as Theme) : undefined;
}

/**
 * Phase 8 Step 5 — Product Intelligence investigation surface for problems.
 * Every row comes directly from GET /v1/problems — this page computes no
 * severity, confidence, or count of its own. `window`/`platform`/`theme`
 * are the only three real backend-supported filters (schemas.ts
 * ProblemsQuerySchema); `theme`'s options are THEME_VOCABULARY, the same
 * fixed controlled vocabulary the backend itself validates against — not an
 * invented list. The response carries no product/evidence identifiers, so
 * this page offers no drill-down — that's a real, verified limitation of
 * the current contract, not an oversight. Capability boundary is communicated
 * honestly via contextual UI rather than hidden as an error.
 */
export function Problems() {
  const [searchParams, setSearchParams] = useSearchParams();
  const window_ = readWindowParam(searchParams.get("window"));
  const platform = readPlatformParam(searchParams.get("platform"));
  const theme = readThemeParam(searchParams.get("theme"));

  function updateParams(next: Partial<{ window: NamedWindow; platform: Platform | ""; theme: Theme | "" }>) {
    const params = new URLSearchParams(searchParams);
    if (next.window !== undefined) params.set("window", next.window);
    if (next.platform !== undefined) {
      if (next.platform) params.set("platform", next.platform);
      else params.delete("platform");
    }
    if (next.theme !== undefined) {
      if (next.theme) params.set("theme", next.theme);
      else params.delete("theme");
    }
    setSearchParams(params, { replace: true });
  }

  const problemsQuery = useProblems({ window: window_, platform, theme });

  const summary = useMemo(() => {
    const total = problemsQuery.data?.themes.length ?? 0;
    return { total };
  }, [problemsQuery.data]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Problems</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cross-product theme clustering — recurring complaint themes across the catalog, by frequency and product spread.
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

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Theme</p>
            <Tabs value={theme ?? "all"} onValueChange={(v) => updateParams({ theme: v === "all" ? "" : (v as Theme) })}>
              <TabsList aria-label="Theme filter" className="h-auto flex-wrap">
                <TabsTrigger value="all">All</TabsTrigger>
                {THEME_VOCABULARY.map((t) => (
                  <TabsTrigger key={t} value={t} className="capitalize">
                    {t.replace(/_/g, " ")}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </section>

      {problemsQuery.isError ? (
        <ErrorState error={problemsQuery.error} onRetry={() => problemsQuery.refetch()} />
      ) : problemsQuery.isPending ? (
        <LoadingState rows={6} />
      ) : problemsQuery.data.themes.length === 0 ? (
        <EmptyState
          title="No recurring problems found for this period"
          description="This is a real analytical result, not an error."
          icon={MessagesSquare}
        />
      ) : (
        <>
          {/* Problems section */}
          <section aria-labelledby="problems-heading" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="problems-heading" className="text-sm font-semibold">
                Problem Themes
              </h2>
              {summary.total > 0 && (
                <span className="inline-block rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {summary.total} {summary.total === 1 ? "theme" : "themes"} found
                </span>
              )}
            </div>

            <ProblemsTable themes={problemsQuery.data.themes} />
          </section>

          {/* Capability boundary messaging */}
          <section aria-labelledby="capability-heading" className="space-y-3">
            <h2 id="capability-heading" className="text-sm font-semibold">
              Next Steps
            </h2>
            <Card className="border-dashed">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <InfoIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p className="font-medium">Product-level investigation not available from this data</p>
                    <p>
                      This page shows problem themes and their frequency across the catalog. To investigate which specific products have a problem,
                      visit the Product Intelligence page for individual products, or use the Rankings view to identify products by health metrics.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
