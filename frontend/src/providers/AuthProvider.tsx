import { createContext, useContext, useMemo, type ReactNode } from "react";
import { env } from "@/config/env";
import { setAuthToken } from "@/api/authToken";
import { decodeJwtPayload, isTokenExpired } from "@/lib/jwt";

export type Role = "admin" | "analyst" | "viewer";

interface AuthState {
  /** Whether a dev token is configured AND not (visibly) expired — display
   * only, see lib/jwt.ts. `false` means the app should show the
   * dev-auth-required screen, not attempt any API call. */
  isConfigured: boolean;
  role: Role | null;
  subject: string | null;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const KNOWN_ROLES: Role[] = ["admin", "analyst", "viewer"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useMemo<AuthState>(() => {
    if (!env.devToken) {
      setAuthToken(undefined);
      return { isConfigured: false, role: null, subject: null };
    }

    const payload = decodeJwtPayload(env.devToken);
    if (!payload || isTokenExpired(payload) || !payload.role || !KNOWN_ROLES.includes(payload.role as Role)) {
      // Malformed/expired/unrecognized-role token — treated the same as
      // "not configured" so the UI shows one honest setup screen rather
      // than a confusing partial-auth state. The real 401 from the API
      // (if this token is somehow sent anyway) is the authoritative check.
      setAuthToken(undefined);
      return { isConfigured: false, role: null, subject: null };
    }

    setAuthToken(env.devToken);
    return { isConfigured: true, role: payload.role as Role, subject: payload.sub ?? null };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
