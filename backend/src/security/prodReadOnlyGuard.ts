import { config, assertDatabaseConfiguration } from "../config/index.js";
import { ProductionSafetyError } from "../shared/errors.js";

/**
 * Security layer 4: startup assertion. Called once at process boot (see
 * server.ts / runIngestion.ts) — validates the unified database configuration
 * and confirms the connection is only ever configured against the two approved
 * source tables (defense-in-depth alongside the fixed export surface, layer 2).
 */
export function runStartupSafetyChecks(): void {
  assertDatabaseConfiguration(config);

  const allowed = config.prodReadOnly.allowedTables;
  if (allowed.length !== 2 || !allowed.includes("flipkart_reviews") || !allowed.includes("myntra_reviews")) {
    throw new ProductionSafetyError(
      "Source table allowlist has drifted from the approved two tables. Refusing to start.",
    );
  }
}
