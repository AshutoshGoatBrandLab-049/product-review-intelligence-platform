import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { ProblemThemeSummary } from "@/types/api";

/**
 * Phase 7 Step 6 — renders exactly what GET /v1/problems returns, in the
 * exact order the backend already sorted it (mentionCount DESC — see
 * problemsAggregate.ts's ORDER BY). No re-sorting here. `ProblemThemeSummary`
 * carries no product/evidence identifiers at all, so no drill-down link is
 * offered — manufacturing one would mean inventing a relationship the API
 * never returned. No severity column exists because none is emitted by the
 * backend (severity.ts has no approved formula).
 */
export function ProblemsTable({ themes }: { themes: ProblemThemeSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Theme</TableHead>
          <TableHead className="text-right">Mentions</TableHead>
          <TableHead className="text-right">Reviews</TableHead>
          <TableHead className="text-right">Products</TableHead>
          <TableHead>Confidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {themes.map((t) => (
          <TableRow key={t.theme}>
            <TableCell className="font-medium capitalize">{t.theme.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-right tabular-nums">{t.mentionCount}</TableCell>
            <TableCell className="text-right tabular-nums">{t.distinctReviewCount}</TableCell>
            <TableCell className="text-right tabular-nums">{t.distinctProductCount}</TableCell>
            <TableCell>
              <ConfidenceBadge value={t.confidence} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
