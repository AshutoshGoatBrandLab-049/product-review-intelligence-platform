import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MarketplaceBadge } from "./MarketplaceBadge";
import type { ThemeConsistencyResult } from "@/types/api";

/**
 * Phase 7 Step 7 — renders exactly what compareBrandAcrossMarketplaces
 * returns for `themeConsistency`, in the order the backend already
 * produced (alphabetical by theme — see marketplaceComparison.ts's
 * `[...allThemes].sort()`), no re-sorting here. A null frequency means the
 * platform had zero reviews for this brand in the window (division by zero
 * avoided server-side) — rendered as "—", never a fabricated 0%.
 */
export function ThemeConsistencyTable({ entries }: { entries: ThemeConsistencyResult[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Theme</TableHead>
          <TableHead className="text-right">Flipkart</TableHead>
          <TableHead className="text-right">Myntra</TableHead>
          <TableHead>Classification</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.theme}>
            <TableCell className="font-medium capitalize">{e.theme.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-right tabular-nums">{e.flipkartFrequencyPercent === null ? "—" : `${e.flipkartFrequencyPercent}%`}</TableCell>
            <TableCell className="text-right tabular-nums">{e.myntraFrequencyPercent === null ? "—" : `${e.myntraFrequencyPercent}%`}</TableCell>
            <TableCell>
              <MarketplaceBadge value={e.classification} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
