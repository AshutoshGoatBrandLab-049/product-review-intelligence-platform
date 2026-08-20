import { config, assertJwtSecretConfigured } from "./config/index.js";
import { createApp } from "./api/app.js";
import { logger } from "./shared/logger.js";
import { isMainModule } from "./shared/isMainModule.js";
import { appWebSocketServer } from "./modules/websocket/index.js";

/**
 * Phase 6 Step 2 — the actual process entrypoint (`npm run dev` / `npm start`,
 * per package.json's existing dev/start scripts, which already pointed here
 * even before this file existed). Only concern beyond app.ts: boot-time
 * safety checks and binding the port.
 *
 * Milestone 2: WebSocket server now starts alongside Express API.
 */
export function startServer(): void {
  assertJwtSecretConfigured();

  const app = createApp();
  const port = config.port;

  app.listen(port, () => {
    logger.info({ port, nodeEnv: config.nodeEnv }, "API server listening");
  });

  // Start WebSocket server on port 8080
  const WEBSOCKET_PORT = parseInt(process.env.WEBSOCKET_PORT || "8080", 10);
  try {
    appWebSocketServer.initialize(WEBSOCKET_PORT);
    logger.info({ port: WEBSOCKET_PORT }, "WebSocket server initialized");
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Failed to initialize WebSocket server");
    // Don't crash the whole server if WebSocket fails, but log it
  }
}

if (isMainModule(import.meta.url)) {
  startServer();
}
