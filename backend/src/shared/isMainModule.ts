import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Robust "is this file being run directly" check for CLI entrypoints.
 *
 * The naive `import.meta.url === \`file://${process.argv[1]}\`` comparison
 * silently fails under some runners (e.g. `tsx`) because process.argv[1] may
 * not be symlink-resolved the way import.meta.url is (macOS resolves /tmp to
 * /private/tmp, for example). Comparing real, resolved filesystem paths
 * avoids that class of bug entirely.
 */
export function isMainModule(moduleUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
