import { CircleDashed } from "lucide-react";
import { DashedStateNotice } from "./DashedState";

/**
 * confidence:"not_ready" — product_deterioration is PERMANENTLY stubbed
 * (deliberate Phase 5 descope: no approved severity formula exists), and
 * complaint_spike falls back to this when no threshold is configured. A
 * real, disclosed gap — never presented as a bug or a failed computation.
 */
export function NotReadyState({ className }: { className?: string }) {
  return <DashedStateNotice icon={CircleDashed} text="Not available yet — this signal is not currently implemented." className={className} />;
}
