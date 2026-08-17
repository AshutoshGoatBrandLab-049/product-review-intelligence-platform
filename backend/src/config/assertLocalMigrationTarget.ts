const LOCAL_SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Security layer: application-store migrations only ever run against a local
 * host. This is an absolute, unconditional refusal — a migration is a
 * schema-altering DDL operation, and this project must never risk running one
 * against an unexpected target, including (especially) the production source.
 *
 * There is deliberately no override parameter and no environment variable
 * that can bypass this check. A prior revision supported
 * ALLOW_REMOTE_APP_MIGRATIONS as an explicit opt-in; that escape hatch was
 * removed by explicit instruction (Phase 1.5) — this project must never be
 * *capable* of running application migrations against a remote database, not
 * even behind a flag someone could set by mistake or under pressure.
 *
 * @param dbHost - the appStore connection's configured host
 */
export function assertLocalMigrationTarget(dbHost: string): void {
  if (LOCAL_SAFE_HOSTS.has(dbHost)) {
    return;
  }

  throw new Error(
    `Refusing to migrate against "${dbHost}" — app-store migrations only ever ` +
      `run against localhost, 127.0.0.1, or ::1. There is no override for this. ` +
      `If a real non-local deployment is ever needed, that requires a deliberate ` +
      `code change and review, not a runtime flag.`,
  );
}
