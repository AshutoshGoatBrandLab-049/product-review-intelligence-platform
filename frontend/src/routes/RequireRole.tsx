import type { ReactNode } from "react";
import { useAuth, type Role } from "@/providers/AuthProvider";
import { NotPermitted } from "@/pages/NotPermitted";

/** Client-side-only convenience gate (§9/§18: never the security boundary
 * — a real 403 from the API is handled separately by ErrorState). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) return <NotPermitted />;
  return <>{children}</>;
}
