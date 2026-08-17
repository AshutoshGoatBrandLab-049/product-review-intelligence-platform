import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Client-side role gate result (§9 of the design doc — defense in depth
 * only; the backend's authorize() middleware is the real, authoritative
 * boundary and would independently reject the request with a real 401/403
 * even if this check were somehow bypassed). */
export function NotPermitted() {
  return (
    <div className="p-6">
      <Alert variant="destructive" className="max-w-lg">
        <ShieldAlert className="size-4" />
        <AlertTitle>Not permitted</AlertTitle>
        <AlertDescription>Your role does not have access to this page.</AlertDescription>
      </Alert>
    </div>
  );
}
