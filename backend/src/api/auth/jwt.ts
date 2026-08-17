import jwt from "jsonwebtoken";
import { config } from "../../config/index.js";

/**
 * Phase 6 Step 2 — the three initial roles, approved as the starting RBAC
 * set. Adding a role later is a type-level change here, not a rewrite of
 * every controller (each controller only ever calls `authorize(...roles)`).
 */
export const ROLES = ["admin", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface TokenPayload {
  sub: string;
  role: Role;
}

/**
 * Deliberately the ONLY place that knows how a token is created — everything
 * downstream (authenticate middleware, controllers) only ever sees the
 * decoded { sub, role } shape. Swapping the identity source later (a real
 * login flow, SSO, etc.) means changing what calls this function, not
 * touching authenticate.ts or any controller.
 */
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.api.jwtSecret, { expiresIn: config.api.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.api.jwtSecret);
  if (typeof decoded !== "object" || decoded === null || !("sub" in decoded) || !("role" in decoded)) {
    throw new Error("Token payload missing required claims");
  }
  const role = (decoded as { role: unknown }).role;
  if (typeof role !== "string" || !ROLES.includes(role as Role)) {
    throw new Error(`Token has an unrecognized role: ${String(role)}`);
  }
  return { sub: String((decoded as { sub: unknown }).sub), role: role as Role };
}
