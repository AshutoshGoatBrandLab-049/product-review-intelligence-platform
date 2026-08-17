import { Link2Off } from "lucide-react";
import { DashedStatePanel } from "./DashedState";

/**
 * available:false, reason:"no_mapping" — product_family_mapping is empty
 * for every real product today (Phase 5/6, PROVEN BY EXECUTION). This is
 * the expected default state for the product-comparison feature, not an
 * edge case or an error — must be a first-class, well-designed state.
 */
export function NoMappingState({ className }: { className?: string }) {
  return (
    <DashedStatePanel
      icon={Link2Off}
      title="Not linked to a comparable product"
      description="This product is not linked to a corresponding product on the other marketplace."
      className={className}
    />
  );
}
