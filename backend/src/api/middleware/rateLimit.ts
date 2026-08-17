import rateLimit from "express-rate-limit";
import { config } from "../../config/index.js";

/**
 * Phase 6 Step 2 — §21's "per-IP/per-token on all endpoints." Applied as
 * global middleware BEFORE authenticate, so a flood of invalid/missing
 * tokens is rate-limited too, not just legitimate authenticated traffic —
 * deliberately IP-keyed rather than per-token for this reason (the token
 * isn't known yet at this point in the pipeline). Values are
 * env-configurable (RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX) — no hardcoded
 * traffic-shape assumption.
 */
export const apiRateLimiter = rateLimit({
  windowMs: config.api.rateLimitWindowMs,
  limit: config.api.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: "rate_limited", message: "Too many requests — slow down." } });
  },
});
