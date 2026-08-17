import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Phase 7 Step 1 — one QueryClient for the whole app. `retry: false` by
 * default: this is an internal analytics tool, not a flaky public API —
 * retrying a 401/403/400 is never useful (same input, same result), and
 * retrying a real server error hides a real problem rather than surfacing
 * it. Individual hooks can opt into retry behavior if a specific endpoint
 * genuinely warrants it.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
