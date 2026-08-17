import { useIngestionStatus, useAiUsage } from "@/hooks/queries/useSystem";
import { useAuth } from "@/providers/AuthProvider";
import { IngestionWatermarksTable } from "@/components/intelligence/IngestionWatermarksTable";
import { AiUsageTable } from "@/components/intelligence/AiUsageTable";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";

/**
 * Phase 7 Step 9 — System/Admin, the last of the 9 pages in the Phase 7
 * architecture design (§5 row 9). Every value comes directly from
 * GET /v1/system/ingestion-status and GET /v1/system/ai-usage — two raw
 * table reads, no computed health/cost figure of any kind. The real
 * security boundary is the backend's `adminOnly` middleware on both
 * routes; `RequireRole` (already wrapping this route in router.tsx) and
 * the `enabled` gate below are UX-only defense in depth, not the
 * authoritative check.
 */
export function System() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const ingestionQuery = useIngestionStatus(isAdmin);
  const aiUsageQuery = useAiUsage(isAdmin);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">System / Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pipeline freshness and AI usage/cost visibility.</p>
      </div>

      <section aria-labelledby="ingestion-heading" className="space-y-3">
        <h2 id="ingestion-heading" className="text-sm font-semibold">
          Ingestion status
        </h2>
        {ingestionQuery.isError ? (
          <ErrorState error={ingestionQuery.error} onRetry={() => ingestionQuery.refetch()} />
        ) : ingestionQuery.isPending ? (
          <LoadingState rows={2} />
        ) : ingestionQuery.data.watermarks.length === 0 ? (
          <EmptyState title="No ingestion watermarks recorded yet" />
        ) : (
          <IngestionWatermarksTable watermarks={ingestionQuery.data.watermarks} />
        )}
      </section>

      <section aria-labelledby="ai-usage-heading" className="space-y-3">
        <h2 id="ai-usage-heading" className="text-sm font-semibold">
          AI usage
        </h2>
        {aiUsageQuery.isError ? (
          <ErrorState error={aiUsageQuery.error} onRetry={() => aiUsageQuery.refetch()} />
        ) : aiUsageQuery.isPending ? (
          <LoadingState rows={3} />
        ) : aiUsageQuery.data.runs.length === 0 ? (
          <EmptyState title="No AI processing runs yet" description="This is a real result — the AI pipeline has never run, not an error." />
        ) : (
          <AiUsageTable runs={aiUsageQuery.data.runs} />
        )}
      </section>
    </div>
  );
}
