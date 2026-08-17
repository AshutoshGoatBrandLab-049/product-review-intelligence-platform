import { config, assertJwtSecretConfigured } from "./config/index.js";
import { createApp } from "./api/app.js";
import { logger } from "./shared/logger.js";
import { isMainModule } from "./shared/isMainModule.js";

/**
 * Phase 6 Step 2 — the actual process entrypoint (`npm run dev` / `npm start`,
 * per package.json's existing dev/start scripts, which already pointed here
 * even before this file existed). Only concern beyond app.ts: boot-time
 * safety checks and binding the port.
 */
export function startServer(): void {
  assertJwtSecretConfigured();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info({ port: config.port, nodeEnv: config.nodeEnv }, "API server listening");
  });
}

if (isMainModule(import.meta.url)) {
  startServer();
}
