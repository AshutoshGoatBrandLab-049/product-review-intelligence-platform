import { config, assertConnectionsAreDistinct } from "../config/index.js";
import { ProductionSafetyError } from "../shared/errors.js";

/**
 * Security layer 4: startup assertion. Called once at process boot (see
 * server.ts / runIngestion.ts) — refuses to proceed if the two connections
 * could resolve to the same database, and independently confirms the
 * production connection is only ever configured against the two approved
 * tables (defense-in-depth alongside the fixed export surface, layer 2).
 */
export function runStartupSafetyChecks(): void {
  assertConnectionsAreDistinct(config);

  const allowed = config.prodReadOnly.allowedTables;
  if (allowed.length !== 2 || !allowed.includes("flipkart_reviews") || !allowed.includes("myntra_reviews")) {
    throw new ProductionSafetyError(
      "Production table allowlist has drifted from the approved two tables. Refusing to start.",
    );
  }
}
