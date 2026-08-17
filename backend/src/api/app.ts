import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { apiRouter } from "./router.js";
import { apiRateLimiter } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";

/**
 * Phase 6 Step 2 — app factory, deliberately separate from server.ts's
 * .listen() call so tests can exercise the app in-process (supertest)
 * without binding a real port or needing JWT_SECRET's boot-time assertion
 * (that check lives in server.ts only, not here — see config/index.ts).
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(apiRateLimiter);

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  app.use(apiRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such route" } });
  });

  app.use(errorHandler);

  return app;
}
