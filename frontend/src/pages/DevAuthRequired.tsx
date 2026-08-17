import { KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * §10 of the design doc: "if missing, show a clear development-only
 * authentication setup screen/message." Rendered when VITE_DEV_TOKEN is
 * absent, malformed, expired, or carries an unrecognized role — the app
 * never attempts an unauthenticated API call in this state.
 */
export function DevAuthRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Alert className="max-w-lg">
        <KeyRound className="size-4" />
        <AlertTitle>Development token required</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            This app has no login flow — Phase 6's API has no login endpoint. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5">VITE_DEV_TOKEN</code> in your <code className="rounded bg-muted px-1 py-0.5">.env.local</code>{" "}
            to a token issued by the backend's dev token script.
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
            {"cd backend && AI_PROVIDER=mock npx tsx scripts/issueDevToken.ts viewer"}
          </pre>
          <p className="text-xs">This is a development-only stand-in — not a production authentication mechanism.</p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
