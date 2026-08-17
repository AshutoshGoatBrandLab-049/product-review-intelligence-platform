/**
 * Minimal, transparent SQL migration runner for the application store ONLY.
 *
 * Deliberately not an ORM auto-sync and not a magic migration DSL — plain,
 * numbered .up.sql/.down.sql file pairs, applied in order, tracked in a
 * schema_migrations table. Anyone can read exactly what will run by opening
 * the file. Never targets the production connection — enforced by
 * assertLocalMigrationTarget() before anything else happens.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../src/shared/isMainModule.js";
import { Client } from "pg";
import { config } from "../src/config/index.js";
import { assertLocalMigrationTarget } from "../src/config/assertLocalMigrationTarget.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

interface Migration {
  name: string;
  upPath: string;
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".up.sql"));
  files.sort();
  return files.map((f) => ({
    name: f.replace(/\.up\.sql$/, ""),
    upPath: join(MIGRATIONS_DIR, f),
  }));
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  // Layer: refuse to migrate against anything but a local host. Absolute,
  // no override — see assertLocalMigrationTarget.ts.
  assertLocalMigrationTarget(config.appStore.host);

  const client = new Client({
    host: config.appStore.host,
    port: config.appStore.port,
    database: config.appStore.database,
    user: config.appStore.user,
    password: config.appStore.password,
  });

  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${config.appStore.schema}"`);
    await client.query(`SET search_path TO "${config.appStore.schema}"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrations = loadMigrations();

    for (const migration of migrations) {
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [migration.name],
      );

      if (rows.length > 0) {
        skipped.push(migration.name);
        continue;
      }

      const sql = readFileSync(migration.upPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(`SET search_path TO "${config.appStore.schema}"`);
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          migration.name,
        ]);
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration "${migration.name}" failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }

  return { applied, skipped };
}

// Run directly via `npm run migrate`.
if (isMainModule(import.meta.url)) {
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(`Applied: ${applied.length ? applied.join(", ") : "(none)"}`);
      console.log(`Already applied: ${skipped.length ? skipped.join(", ") : "(none)"}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
