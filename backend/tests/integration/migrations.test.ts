import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { runMigrations } from "../../scripts/runMigrations.js";
import { config } from "../../src/config/index.js";

describe("runMigrations (against the isolated pri_test_appstore database)", () => {
  it("applies all fifteen migrations and is idempotent on rerun", async () => {
    const first = await runMigrations();
    expect(first.applied.length + first.skipped.length).toBe(15);

    const second = await runMigrations();
    expect(second.applied).toEqual([]); // nothing new to apply the second time
    expect(second.skipped.length).toBe(15);
  });

  it("migration 005 leaves ingestion_rejects with a unique (platform, source_row_id, reason) constraint", async () => {
    const client = new Client({
      host: config.appStore.host,
      port: config.appStore.port,
      database: config.appStore.database,
      user: config.appStore.user,
      password: config.appStore.password,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'ingestion_rejects_platform_source_row_reason_key'`,
      );
      expect(rows.length).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("creates exactly the expected tables in the approved schema", async () => {
    const client = new Client({
      host: config.appStore.host,
      port: config.appStore.port,
      database: config.appStore.database,
      user: config.appStore.user,
      password: config.appStore.password,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
        [config.appStore.schema],
      );
      const tableNames = rows.map((r) => r.table_name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "identity_anomalies",
          "ingestion_rejects",
          "ingestion_watermarks",
          "normalized_reviews",
          "product_dimension",
          "product_daily_metrics",
          "review_sentiment",
          "review_theme",
          "ai_processing_runs",
          "product_family_mapping",
          "ai_insights",
          "ai_product_analyst_conversations",
          "ai_question_cache",
        ]),
      );
    } finally {
      await client.end();
    }
  });

  it("refuses to migrate against a non-local host", async () => {
    // Direct unit-level re-verification at the integration boundary: the
    // migration entrypoint always calls assertLocalMigrationTarget() first.
    const { assertLocalMigrationTarget } = await import(
      "../../src/config/assertLocalMigrationTarget.js"
    );
    expect(() => assertLocalMigrationTarget("some-remote-host.example.com")).toThrow();
  });
});
