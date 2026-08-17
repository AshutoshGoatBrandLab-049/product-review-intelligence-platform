import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../errors.js";

/**
 * Phase 6 Step 2 — §21's "every request validated against a schema before
 * touching a service" applied literally: params/query are parsed and
 * replaced with their validated (and coerced) form before any controller
 * runs, so a controller never touches req.params/req.query raw.
 */
export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError(`Invalid path parameters: ${result.error.issues.map((i) => i.message).join("; ")}`));
      return;
    }
    // Express 5's req.params has no public setter — validated/coerced values
    // go on a side channel instead of reassigning req.params directly.
    (req as Request & { validatedParams: T }).validatedParams = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError(`Invalid query parameters: ${result.error.issues.map((i) => i.message).join("; ")}`));
      return;
    }
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}

/** Typed accessors — the only sanctioned way a controller reads validated
 * input; reading req.params/req.query directly in a controller is a bug. */
export function getValidatedParams<T>(req: Request): T {
  return (req as Request & { validatedParams: T }).validatedParams;
}

export function getValidatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}
