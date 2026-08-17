import type { NextFunction, Request, Response } from "express";

/** Express 5 does forward rejected promises to next() automatically for
 * async handlers, but wrapping explicitly keeps error flow identical and
 * obvious regardless of Express version — no behavior depends on that
 * implicit guarantee. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
