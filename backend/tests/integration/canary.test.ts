import { describe, it, expect } from "vitest";
import { runCanary } from "../../src/security/canary.js";

describe("read-only production canary (against the local fixture, mirroring prod shape)", () => {
  it("passes all checks — identity, connectivity, and both tables readable", async () => {
    const result = await runCanary();
    expect(result.checks.connectivity).toBe(true);
    expect(result.checks.flipkartReadable).toBe(true);
    expect(result.checks.myntraReadable).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("never issues anything but SELECT — verified by the fact it succeeds under a SELECT-only role", async () => {
    // If the canary ever attempted a write, this run would fail outright
    // against local_review_intel_ro's SELECT-only grants (see
    // tests/security/localRoleWriteRejection.test.ts for the direct proof
    // that this role does reject writes).
    const result = await runCanary();
    expect(result.ok).toBe(true);
  });
});
