import { useMemo, useState } from "react";
import { FileText, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Phase 8 Step 8 — Evidence Investigation Experience.
 * Displays opaque review-ID citations in a drawer/sheet.
 * Strictly limited to ID/citation-count display per §19/§20's hard ceiling.
 * Never displays review_text, title, or author — evidence is ID-only.
 */
export function EvidenceDrawer({ reviewIds }: { reviewIds: string[] }) {
  const [isOpen, setIsOpen] = useState(false);

  const citationCount = reviewIds.length;
  const displayIds = useMemo(() => reviewIds.sort(), [reviewIds]);

  if (citationCount === 0) {
    return null;
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span>
            {citationCount} {citationCount === 1 ? "review" : "reviews"} support this
          </span>
          <ChevronRight className="size-3" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Evidence Citations</SheetTitle>
          <SheetDescription>
            {citationCount} review{citationCount !== 1 ? "s" : ""} cited as evidence for this signal
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="space-y-2">
            {displayIds.map((id) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded border bg-muted/30 px-3 py-2 text-xs"
              >
                <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <code className="font-mono text-muted-foreground">{id}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4 text-xs text-muted-foreground">
          <p>These are opaque review identifiers used for evidence tracking.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
