import { describe, it, expect } from "vitest";
import { assertDatabaseConfiguration, config, type AppConfig } from "../../src/config/index.js";

function withAppStoreOverrides(overrides: Partial<AppConfig["appStore"]>): AppConfig {
  return {
    ...config,
    appStore: { ...config.appStore, ...overrides },
  };
}

describe("assertDatabaseConfiguration", () => {
  it("passes for the real test configuration (test mode is lenient)", () => {
    expect(() => assertDatabaseConfiguration(config)).not.toThrow();
  });

  it("enforces strict checks only in production mode", () => {
    const prodConfig = {
      ...config,
      nodeEnv: "production" as const,
      appStore: { ...config.appStore, schema: "wrong_schema" },
    };
    expect(() => assertDatabaseConfiguration(prodConfig)).toThrow(/Schema must be 'DataWarehouse'/);
  });

  it("passes in test mode even with non-standard database names", () => {
    const testConfig = {
      ...config,
      nodeEnv: "test" as const,
      appStore: {
        ...config.appStore,
        schema: "product_review_intelligence",
        database: "pri_test_appstore",
        user: "test_user",
        host: "wrong.example.com",
      },
    };
    expect(() => assertDatabaseConfiguration(testConfig)).not.toThrow();
  });

  it("throws in production if schema is not DataWarehouse", () => {
    const badConfig = {
      ...config,
      nodeEnv: "production" as const,
      appStore: { ...config.appStore, schema: "product_review_intelligence" },
    };
    expect(() => assertDatabaseConfiguration(badConfig)).toThrow(/Schema must be 'DataWarehouse'/);
  });

  it("throws in production if database is not gbl_data_lake", () => {
    const badConfig = {
      ...config,
      nodeEnv: "production" as const,
      appStore: { ...config.appStore, database: "wrong_database" },
    };
    expect(() => assertDatabaseConfiguration(badConfig)).toThrow(/Database must be 'gbl_data_lake'/);
  });

  it("throws in production if host is not localhost", () => {
    const badConfig = {
      ...config,
      nodeEnv: "production" as const,
      appStore: { ...config.appStore, host: "prod.example.com" },
    };
    expect(() => assertDatabaseConfiguration(badConfig)).toThrow(/Host must be localhost/);
  });

  it("throws in production if user is not postgres", () => {
    const badConfig = {
      ...config,
      nodeEnv: "production" as const,
      appStore: { ...config.appStore, user: "wrong_user" },
    };
    expect(() => assertDatabaseConfiguration(badConfig)).toThrow(/User must be 'postgres'/);
  });
});

describe("config.prodReadOnly.allowedTables", () => {
  it("contains exactly the two approved tables", () => {
    expect(config.prodReadOnly.allowedTables).toEqual(["flipkart_reviews", "myntra_reviews"]);
  });
});
