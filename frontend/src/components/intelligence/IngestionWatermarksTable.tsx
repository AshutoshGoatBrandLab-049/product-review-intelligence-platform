import { CircleDashed, Loader2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import type { IngestionWatermarkRow } from "@/types/api";

function formatDateTime(iso: string | null): string {
  return iso === null ? "—" : new Date(iso).toLocaleString();
}

const STATUS_CONFIG: Record<IngestionWatermarkRow["status"], { icon: typeof CircleDashed; tone: StatusTone }> = {
  idle: { icon: CircleDashed, tone: "neutral" },
  running: { icon: Loader2, tone: "info" },
};

/**
 * Phase 7 Step 9 — renders exactly what GET /v1/system/ingestion-status
 * returns, one row per platform, in the order the backend already sorted
 * it (`ORDER BY platform`). `status` is the real two-value enum
 * (`idle`/`running`) straight off `ingestion_watermarks` — displayed as a
 * literal-value badge (Phase 8 Step 1: via the shared StatusBadge tone
 * system), not passed through the unrelated healthy/warning/error/unknown
 * vocabulary of SystemStatusBadge (which doesn't correspond to this
 * column at all).
 */
export function IngestionWatermarksTable({ watermarks }: { watermarks: IngestionWatermarkRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Platform</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Last seen source ID</TableHead>
          <TableHead>Last reconciliation run</TableHead>
          <TableHead className="text-right">Rows scanned</TableHead>
          <TableHead className="text-right">Rows changed</TableHead>
          <TableHead>Lock acquired</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {watermarks.map((w) => (
          <TableRow key={w.platform}>
            <TableCell className="capitalize">{w.platform}</TableCell>
            <TableCell>
              <StatusBadge tone={STATUS_CONFIG[w.status].tone} icon={STATUS_CONFIG[w.status].icon} label={w.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{w.last_seen_source_id}</TableCell>
            <TableCell>{formatDateTime(w.last_reconciliation_run_at)}</TableCell>
            <TableCell className="text-right tabular-nums">{w.last_reconciliation_rows_scanned ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{w.last_reconciliation_rows_changed ?? "—"}</TableCell>
            <TableCell>{formatDateTime(w.lock_acquired_at)}</TableCell>
            <TableCell>{formatDateTime(w.updated_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
