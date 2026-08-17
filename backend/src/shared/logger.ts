import pino from "pino";
import { config } from "../config/index.js";

/**
 * Fields that must never appear in a log line — customer-authored free text
 * that could carry names, phone numbers, or other identifying detail. Logs
 * may reference canonical_review_id, platform, product keys, counts, and
 * error text — never raw review content.
 */
const FORBIDDEN_LOG_KEYS = new Set([
  "reviewText",
  "review_text",
  "title",
  "author",
  "authorName",
  "author_name",
  "rawPayload",
  "raw_payload",
]);

function containsForbiddenKey(obj: unknown, seen = new Set<unknown>()): boolean {
  if (obj === null || typeof obj !== "object" || seen.has(obj)) return false;
  seen.add(obj);
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_LOG_KEYS.has(key)) return true;
    if (containsForbiddenKey(value, seen)) return true;
  }
  return false;
}

const basePino = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

/**
 * Runtime backstop for the PII rule, not just a written policy: in
 * development this throws immediately so the offending call site is obvious
 * during testing; in production it strips the object and logs a warning
 * instead of ever emitting the forbidden content.
 */
function guardedLog(
  level: "info" | "warn" | "error" | "debug",
  obj: Record<string, unknown>,
  msg: string,
): void {
  if (containsForbiddenKey(obj)) {
    if (config.nodeEnv !== "production") {
      throw new Error(
        `Refusing to log: object contains a forbidden PII-risk key. Log only ` +
          `canonical_review_id, platform, product keys, counts, and error text.`,
      );
    }
    basePino.warn({ msg: "log call blocked — forbidden key present" });
    return;
  }
  basePino[level](obj, msg);
}

export const logger = {
  info: (obj: Record<string, unknown>, msg: string) => guardedLog("info", obj, msg),
  warn: (obj: Record<string, unknown>, msg: string) => guardedLog("warn", obj, msg),
  error: (obj: Record<string, unknown>, msg: string) => guardedLog("error", obj, msg),
  debug: (obj: Record<string, unknown>, msg: string) => guardedLog("debug", obj, msg),
};
