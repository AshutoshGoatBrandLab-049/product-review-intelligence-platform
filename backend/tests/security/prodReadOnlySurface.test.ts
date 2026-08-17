import { describe, it, expect } from "vitest";
import * as prodReadOnly from "../../src/database/prodReadOnly/index.js";

describe("prodReadOnly module surface — structural safety guarantee", () => {
  it("exports exactly the four approved functions, nothing else", () => {
    const exportedNames = Object.keys(prodReadOnly).sort();
    expect(exportedNames).toEqual(
      [
        "getFlipkartReviewsByDateWindow",
        "getFlipkartReviewsPage",
        "getMyntraReviewsByDateWindow",
        "getMyntraReviewsPage",
      ].sort(),
    );
  });

  it("exposes no generic query executor", () => {
    const exported = prodReadOnly as Record<string, unknown>;
    expect(exported.query).toBeUndefined();
    expect(exported.execute).toBeUndefined();
    expect(exported.runQuery).toBeUndefined();
    expect(exported.sequelize).toBeUndefined();
  });
});
