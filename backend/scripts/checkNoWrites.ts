/**
 * Security layer 3: CI static check. Scans every file under
 * src/database/prodReadOnly/ for write-shaped SQL keywords and fails the
 * build on a match. Catches what code review might miss — a second,
 * independent guarantee alongside the fixed export surface (layer 2).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../src/shared/isMainModule.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = join(__dirname, "..", "src", "database", "prodReadOnly");

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\S/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bDROP\s+\S/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bCREATE\s+(TABLE|INDEX|VIEW|TRIGGER|FUNCTION)\b/i,
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

export function checkNoWrites(targetDir: string = TARGET_DIR): { ok: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const file of walk(targetDir)) {
    const content = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${file}: matches forbidden pattern ${pattern}`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

if (isMainModule(import.meta.url)) {
  const { ok, violations } = checkNoWrites();
  if (!ok) {
    console.error("Write-shaped SQL found in database/prodReadOnly/:");
    violations.forEach((v) => console.error(`  ${v}`));
    process.exit(1);
  }
  console.log("OK — no write-shaped SQL found in database/prodReadOnly/.");
  process.exit(0);
}
