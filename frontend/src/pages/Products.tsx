import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ListOrdered, X } from "lucide-react";
import { useProductRankings } from "@/hooks/queries/useCategoryC";
import { useIsMobile } from "@/hooks/use-mobile";
import { WindowSelector } from "@/components/intelligence/WindowSelector";
import { RankingsTable } from "@/components/intelligence/RankingsTable";
import { RankingsCards } from "@/components/intelligence/RankingsCards";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import type { NamedWindow, Platform, RankingsSort } from "@/types/api";

const NAMED_WINDOWS: NamedWindow[] = ["7d", "30d", "60d", "90d", "6m", "12m"];
const DEFAULT_WINDOW: NamedWindow = "30d";
const DEFAULT_SORT: RankingsSort = "health";
const DEFAULT_PAGE_SIZE = 20; // no page-size selector this step — fixed, well within the backend's max of 100

const SORT_EXPLANATION: Record<RankingsSort, string> = {
  health: "Orders by real-time rating score (0-100 scale) — not a composite score. Severity/total remain unavailable.",
  rating: "Orders by average customer rating for the selected window.",
};

function readWindowParam(raw: string | null): NamedWindow {
  return (NAMED_WINDOWS as string[]).includes(raw ?? "") ? (raw as NamedWindow) : DEFAULT_WINDOW;
}

function readSortParam(raw: string | null): RankingsSort {
  return raw === "rating" ? "rating" : DEFAULT_SORT;
}

function readPlatformParam(raw: string | null): Platform | undefined {
  return raw === "flipkart" || raw === "myntra" ? raw : undefined;
}

function readPageParam(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Phase 7 Step 4 / Phase 8 Step 3 — Product Rankings. Every row comes
 * directly from GET /v1/products/rankings — this page computes no ranking
 * or score of its own; sort=health|rating are the only two sort modes the
 * backend supports (§2 of the Step 1 architecture design doc, §7 filtering
 * strategy) — no "severity" sort is offered because the field doesn't
 * exist. `brand` is an exact-match filter server-side, not a search —
 * labeled honestly as such. Phase 8 Step 3: added a results-summary row
 * with removable filter chips (presentational only, clearing a chip just
 * calls the same updateParams already used by the filter controls) and a
 * dedicated mobile/tablet card layout (RankingsCards) instead of relying
 * on horizontal table scroll.
 */
export function Products() {
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const window_ = readWindowParam(searchParams.get("window"));
  const sort = readSortParam(searchParams.get("sort"));
  const platform = readPlatformParam(searchParams.get("platform"));
  const page = readPageParam(searchParams.get("page"));
  const brandParam = searchParams.get("brand") ?? "";

  // Local, uncommitted text — only becomes a real filter (and a real
  // request) when the user explicitly applies it, not on every keystroke.
  const [brandDraft, setBrandDraft] = useState(brandParam);

  function updateParams(next: Partial<{ window: NamedWindow; sort: RankingsSort; platform: Platform | ""; brand: string; page: number }>) {
    const params = new URLSearchParams(searchParams);
    if (next.window !== undefined) params.set("window", next.window);
    if (next.sort !== undefined) params.set("sort", next.sort);
    if (next.platform !== undefined) {
      if (next.platform) params.set("platform", next.platform);
      else params.delete("platform");
    }
    if (next.brand !== undefined) {
      if (next.brand) params.set("brand", next.brand);
      else params.delete("brand");
    }
    // Any real filter/sort/window change invalidates the current page —
    // never silently show "page 3" of a completely different result set.
    if (next.page !== undefined) params.set("page", String(next.page));
    else params.set("page", "1");
    setSearchParams(params, { replace: true });
  }

  const rankingsQuery = useProductRankings({
    window: window_,
    sort,
    platform,
    brand: brandParam || undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const totalPages = rankingsQuery.data ? Math.max(1, Math.ceil(rankingsQuery.data.totalCount / rankingsQuery.data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Product Rankings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sortable, filterable, paginated view of the whole catalog.</p>
        </div>
        <WindowSelector value={window_} onChange={(w) => updateParams({ window: w })} />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Sort</p>
          <Tabs value={sort} onValueChange={(v) => updateParams({ sort: v as RankingsSort })}>
            <TabsList aria-label="Sort by">
              <TabsTrigger value="health">Health</TabsTrigger>
              <TabsTrigger value="rating">Rating</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Platform</p>
          <Tabs value={platform ?? "all"} onValueChange={(v) => updateParams({ platform: v === "all" ? "" : (v as Platform) })}>
            <TabsList aria-label="Platform filter">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="flipkart">Flipkart</TabsTrigger>
              <TabsTrigger value="myntra">Myntra</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({ brand: brandDraft.trim() });
          }}
        >
          <label htmlFor="brand-filter" className="text-xs text-muted-foreground">
            Brand (exact match)
          </label>
          <div className="flex gap-2">
            <Input id="brand-filter" value={brandDraft} onChange={(e) => setBrandDraft(e.target.value)} placeholder="e.g. Bluepeak" className="h-8 w-40" />
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

      <p className="text-xs text-muted-foreground">{SORT_EXPLANATION[sort]}</p>

      {rankingsQuery.isError ? (
        <ErrorState error={rankingsQuery.error} onRetry={() => rankingsQuery.refetch()} />
      ) : rankingsQuery.isPending ? (
        <LoadingState rows={6} />
      ) : rankingsQuery.data.items.length === 0 ? (
        <EmptyState title="No products match these filters" icon={ListOrdered} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {rankingsQuery.data.totalCount} product{rankingsQuery.data.totalCount === 1 ? "" : "s"} match
              {platform || brandParam ? "ing" : ""} the current filters
            </span>
            {platform && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                {platform}
                <button
                  type="button"
                  aria-label={`Remove platform filter (${platform})`}
                  onClick={() => updateParams({ platform: "" })}
                  className="rounded-full hover:text-foreground"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            )}
            {brandParam && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium">
                {brandParam}
                <button
                  type="button"
                  aria-label={`Remove brand filter (${brandParam})`}
                  onClick={() => {
                    setBrandDraft("");
                    updateParams({ brand: "" });
                  }}
                  className="rounded-full hover:text-foreground"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>

          {isMobile ? (
            <RankingsCards items={rankingsQuery.data.items} sort={rankingsQuery.data.sort} page={rankingsQuery.data.page} pageSize={rankingsQuery.data.pageSize} />
          ) : (
            <RankingsTable items={rankingsQuery.data.items} sort={rankingsQuery.data.sort} />
          )}

          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">
              Page {rankingsQuery.data.page} of {totalPages} · {rankingsQuery.data.totalCount} product{rankingsQuery.data.totalCount === 1 ? "" : "s"}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => updateParams({ page: page - 1 })}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => updateParams({ page: page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
