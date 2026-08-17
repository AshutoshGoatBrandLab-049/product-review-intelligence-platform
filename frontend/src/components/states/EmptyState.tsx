import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { DashedStatePanel } from "./DashedState";

/** A real "nothing here" result — never rendered the same as a loading or
 * error state (§3/§5 of the design doc: e.g. productCount:0 is a valid,
 * distinct state, not a blank dashboard). */
export function EmptyState({
  title,
  description,
  icon = Inbox,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return <DashedStatePanel icon={icon} title={title} description={description} className={className} />;
}
