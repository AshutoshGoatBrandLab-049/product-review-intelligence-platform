import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNoWrites } from "../../scripts/checkNoWrites.js";

describe("checkNoWrites (security layer 3 — static CI scan)", () => {
  it("passes against the real database/prodReadOnly/ directory", () => {
    const { ok, violations } = checkNoWrites();
    expect(violations).toEqual([]);
    expect(ok).toBe(true);
  });

  describe("against deliberately broken fixture files", () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it("flags a file containing INSERT INTO", () => {
      dir = mkdtempSync(join(tmpdir(), "checkNoWrites-"));
      writeFileSync(join(dir, "bad.ts"), `pool.query("INSERT INTO foo VALUES (1)")`);
      const { ok, violations } = checkNoWrites(dir);
      expect(ok).toBe(false);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("flags a file containing DELETE FROM", () => {
      dir = mkdtempSync(join(tmpdir(), "checkNoWrites-"));
      writeFileSync(join(dir, "bad.ts"), `pool.query("DELETE FROM flipkart_reviews")`);
      const { ok } = checkNoWrites(dir);
      expect(ok).toBe(false);
    });

    it("flags a file containing DROP TABLE", () => {
      dir = mkdtempSync(join(tmpdir(), "checkNoWrites-"));
      writeFileSync(join(dir, "bad.ts"), `pool.query("DROP TABLE myntra_reviews")`);
      const { ok } = checkNoWrites(dir);
      expect(ok).toBe(false);
    });

    it("does not flag ordinary SELECT-only code", () => {
      dir = mkdtempSync(join(tmpdir(), "checkNoWrites-"));
      writeFileSync(join(dir, "good.ts"), `pool.query("SELECT * FROM flipkart_reviews WHERE id > $1", [afterId])`);
      const { ok, violations } = checkNoWrites(dir);
      expect(ok).toBe(true);
      expect(violations).toEqual([]);
    });
  });
});
