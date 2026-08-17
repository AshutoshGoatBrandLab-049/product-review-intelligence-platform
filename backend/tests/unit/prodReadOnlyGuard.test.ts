import { describe, it, expect } from "vitest";
import { runStartupSafetyChecks } from "../../src/security/prodReadOnlyGuard.js";

describe("runStartupSafetyChecks (security layer 4)", () => {
  it("passes for the real test configuration", () => {
    expect(() => runStartupSafetyChecks()).not.toThrow();
  });
});
