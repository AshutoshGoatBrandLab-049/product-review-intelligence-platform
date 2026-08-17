import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import { AiProviderError } from "../../modules/ai/providers/aiProvider.js";
import { logger } from "../../shared/logger.js";

/**
 * Phase 6 Step 2 — the single place HTTP status codes are decided. No
 * controller ever sets a status directly for an error path; every error
 * either IS an ApiError (already carries its status) or gets mapped here.
 * AiProviderError's existing category/retryable fields (Phase 4.1) are
 * reused as-is — never re-classified, never re-guessed at the API layer.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof AiProviderError) {
    // provider_rate_limit/provider_timeout/provider_unavailable are the
    // caller's problem to retry, not the API's fault -> 503; auth/validation
    // failures on the provider side are a server misconfiguration -> 502.
    const status = err.category === "provider_rate_limit" || err.category === "provider_timeout" || err.category === "provider_unavailable" ? 503 : 502;
    res.status(status).json({
      error: { code: `ai_${err.category}`, message: err.message, retryable: err.retryable, retryAfterMs: err.retryAfterMs },
    });
    return;
  }

  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: error.message, path: req.path, method: req.method }, "Unhandled API error");
  res.status(500).json({ error: { code: "internal_error", message: "An unexpected error occurred" } });
}
