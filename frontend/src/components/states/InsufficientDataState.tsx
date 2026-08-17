import { CircleHelp } from "lucide-react";
import { DashedStateNotice } from "./DashedState";

/**
 * confidence:"insufficient_data" — a real, deliberate backend state (sample
 * size below the floor, analytics/confidence.ts), never presented as a
 * system failure. Per your explicit instruction: never turn this into a
 * misleading zero.
 */
export function InsufficientDataState({ className }: { className?: string }) {
  return <DashedStateNotice icon={CircleHelp} text="Not enough review data to make a reliable assessment." className={className} />;
}
