import { RouterProvider } from "react-router-dom";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { DevAuthRequired } from "@/pages/DevAuthRequired";
import { router } from "@/routes/router";

function AuthGate() {
  const { isConfigured } = useAuth();
  if (!isConfigured) return <DevAuthRequired />;
  return <RouterProvider router={router} />;
}

/**
 * Phase 7 Step 1 — root component. Provider order matters: AuthProvider
 * must be outermost since it writes the token the API client reads
 * (api/authToken.ts) before any query can fire; QueryProvider must wrap
 * everything that could ever call useQuery, which is everything under the
 * router.
 */
export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WebSocketProvider>
          <QueryProvider>
            <AuthGate />
          </QueryProvider>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
