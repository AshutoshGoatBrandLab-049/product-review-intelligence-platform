import { AlertTriangle, WifiOff, ShieldAlert, Lock, Clock, RotateCcw } from "lucide-react";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/api/errors";

/**
 * Renders the real, normalized error kind (api/errors.ts) — never a generic
 * "something went wrong" for a case the app can actually explain (§16, §18
 * of the design doc: never leak internals, but do surface the real kind:
 * unauthorized vs. forbidden vs. rate-limited are meaningfully different to
 * a user). `onRetry`, added in Phase 7 Step 2 (§14), is optional and
 * backward-compatible — every existing caller from Step 1 still works
 * unchanged.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case "unauthorized":
        return (
          <ErrorAlert icon={Lock} title="Session expired" description="Your session is no longer valid. Refresh with a valid development token." />
        );
      case "forbidden":
        return <ErrorAlert icon={ShieldAlert} title="Not permitted" description="Your role does not have access to this." />;
      case "rate_limited":
        return <ErrorAlert icon={Clock} title="Too many requests" description="Please wait a moment and try again." onRetry={onRetry} />;
      case "network":
        return (
          <ErrorAlert icon={WifiOff} title="Can't reach the API" description="Check your connection or that the API server is running." onRetry={onRetry} />
        );
      case "ai_unavailable":
        return (
          <ErrorAlert
            icon={AlertTriangle}
            title="AI insight temporarily unavailable"
            description={error.retryable ? "This is usually temporary — try again shortly." : "The AI provider reported an error."}
            onRetry={error.retryable ? onRetry : undefined}
          />
        );
      default:
        return <ErrorAlert icon={AlertTriangle} title="Something went wrong" description={error.message} onRetry={onRetry} />;
    }
  }
  return <ErrorAlert icon={AlertTriangle} title="Something went wrong" description="An unexpected error occurred." onRetry={onRetry} />;
}

function ErrorAlert({
  icon: Icon,
  title,
  description,
  onRetry,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <Icon className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
