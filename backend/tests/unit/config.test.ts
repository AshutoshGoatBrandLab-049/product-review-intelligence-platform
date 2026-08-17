import { describe, it, expect } from "vitest";
import { assertConnectionsAreDistinct, config, type AppConfig } from "../../src/config/index.js";

function withOverrides(overrides: Partial<AppConfig["prodReadOnly"]>): AppConfig {
  return {
    ...config,
    prodReadOnly: { ...config.prodReadOnly, ...overrides },
  };
}

describe("assertConnectionsAreDistinct", () => {
  it("passes for the real test configuration (appStore and prodReadOnly are genuinely different databases)", () => {
    expect(() => assertConnectionsAreDistinct(config)).not.toThrow();
  });

  it("throws if host, database, and user all match the appStore connection", () => {
    const badConfig = withOverrides({
      host: config.appStore.host,
      database: config.appStore.database,
      user: config.appStore.user,
    });
    expect(() => assertConnectionsAreDistinct(badConfig)).toThrow(/Refusing to start/);
  });

  it("does not throw if only host and database match but user differs", () => {
    const almostBadConfig = withOverrides({
      host: config.appStore.host,
      database: config.appStore.database,
      user: "a-different-user",
    });
    expect(() => assertConnectionsAreDistinct(almostBadConfig)).not.toThrow();
  });
});

describe("config.prodReadOnly.allowedTables", () => {
  it("contains exactly the two approved tables", () => {
    expect(config.prodReadOnly.allowedTables).toEqual(["flipkart_reviews", "myntra_reviews"]);
  });
});
