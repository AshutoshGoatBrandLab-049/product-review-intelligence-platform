import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { AiProcessingRunRow } from "@/types/api";

function formatDateTime(iso: string | null): string {
  return iso === null ? "—" : new Date(iso).toLocaleString();
}

const STATUS_CONFIG: Record<AiProcessingRunRow["status"], { icon: typeof CheckCircle2; tone: StatusTone }> = {
  running: { icon: Loader2, tone: "info" },
  success: { icon: CheckCircle2, tone: "success" },
  partial_failure: { icon: AlertTriangle, tone: "warning" },
  failed: { icon: XCircle, tone: "danger" },
};

/**
 * Phase 7 Step 9 — renders exactly what GET /v1/system/ai-usage returns
 * (the most recent 50 ai_processing_runs rows, already ordered by
 * started_at DESC server-side — never re-sorted here). `status` is the
 * real four-value enum straight off the table, badged 1:1 by its literal
 * value (Phase 8 Step 1: via the shared StatusBadge tone system) — not
 * passed through SystemStatusBadge's unrelated vocabulary. duration_ms/
 * finished_at are null while a run is still in progress — rendered as
 * "—", never a fabricated 0 or "done".
 */
export function AiUsageTable({ runs }: { runs: AiProcessingRunRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job ID</TableHead>
          <TableHead>Platform</TableHead>
          <TableHead>Provider / Model</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Candidates</TableHead>
          <TableHead className="text-right">Processed</TableHead>
          <TableHead className="text-right">Success</TableHead>
          <TableHead className="text-right">Failure</TableHead>
          <TableHead className="text-right">Retries</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Finished</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono text-xs">{r.job_id}</TableCell>
            <TableCell className="capitalize">{r.platform ?? "—"}</TableCell>
            <TableCell className="text-xs">
              {r.provider} / {r.model_version}
            </TableCell>
            <TableCell>
              <StatusBadge tone={STATUS_CONFIG[r.status].tone} icon={STATUS_CONFIG[r.status].icon} label={r.status.replace(/_/g, " ")} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.candidate_count}</TableCell>
            <TableCell className="text-right tabular-nums">{r.processed_count}</TableCell>
            <TableCell className="text-right tabular-nums">{r.success_count}</TableCell>
            <TableCell className="text-right tabular-nums">{r.failure_count}</TableCell>
            <TableCell className="text-right tabular-nums">{r.retry_count}</TableCell>
            <TableCell>{formatDateTime(r.started_at)}</TableCell>
            <TableCell>{formatDateTime(r.finished_at)}</TableCell>
            <TableCell className="text-right tabular-nums">{r.duration_ms === null ? "—" : `${r.duration_ms} ms`}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
