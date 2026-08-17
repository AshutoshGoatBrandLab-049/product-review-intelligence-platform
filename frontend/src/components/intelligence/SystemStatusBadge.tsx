import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/**
 * Not consumed by System.tsx today — its vocabulary (healthy/warning/
 * error/unknown) doesn't correspond to either real backend enum there
 * (ingestion_watermarks.status is idle/running; ai_processing_runs.status
 * is running/success/partial_failure/failed), so those tables render
 * their own literal-value badges instead (see IngestionWatermarksTable/
 * AiUsageTable). Kept for any future genuinely-computed health rollup —
 * still built on the shared StatusBadge tone system as of Phase 8 Step 1.
 */
export type SystemStatus = "healthy" | "warning" | "error" | "unknown";

const CONFIG: Record<SystemStatus, { label: string; icon: typeof CheckCircle2; tone: StatusTone }> = {
  healthy: { label: "Healthy", icon: CheckCircle2, tone: "success" },
  warning: { label: "Warning", icon: AlertTriangle, tone: "warning" },
  error: { label: "Error", icon: XCircle, tone: "danger" },
  unknown: { label: "Unknown", icon: HelpCircle, tone: "neutral" },
};

export function SystemStatusBadge({ status, className }: { status: SystemStatus; className?: string }) {
  const { label, icon, tone } = CONFIG[status];
  return <StatusBadge tone={tone} icon={icon} label={label} className={className} />;
}
