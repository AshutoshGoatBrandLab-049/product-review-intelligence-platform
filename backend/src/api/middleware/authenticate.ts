import type { NextFunction, Request, Response } from "express";
import { verifyToken, type Role, type TokenPayload } from "../auth/jwt.js";
import { UnauthorizedError, ForbiddenError } from "../errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Phase 6 Step 2 — verifies the Bearer token and attaches `req.user`. This
 * is the ONLY place in the API that knows a token is a JWT at all — every
 * controller and every authorize() call only ever reads `req.user.role`.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new UnauthorizedError("Missing Authorization: Bearer <token> header"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) {
    next(new UnauthorizedError("Empty bearer token"));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    next(new UnauthorizedError(`Invalid or expired token: ${(err as Error).message}`));
  }
}

/**
 * RBAC gate — must run after authenticate(). Kept as a separate middleware
 * (not folded into authenticate) so a route can require authentication
 * without a role restriction, or layer a role restriction on top.
 */
export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError(`Role "${req.user.role}" is not permitted here — requires one of: ${allowedRoles.join(", ")}`));
      return;
    }
    next();
  };
}
