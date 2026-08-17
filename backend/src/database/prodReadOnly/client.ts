import { Pool, types } from "pg";
import { config } from "../../config/index.js";

/**
 * pg's default parser for DATE columns (OID 1082) constructs a JS Date at
 * LOCAL midnight, which can silently shift the calendar date by a day when
 * later read back in a different timezone context (a well-known pg gotcha).
 * Since `review_date` is exactly the field this platform's date_confidence
 * and reconciliation-window logic depends on being precise, disable that
 * conversion and keep it as the raw "YYYY-MM-DD" string Postgres returns —
 * matching RawFlipkartReview/RawMyntraReview's declared string type exactly.
 */
types.setTypeParser(1082, (val: string) => val);

/**
 * The ONLY connection pool this module ever creates, using DB_PROD_* only.
 * Deliberately raw `pg`, never Sequelize — see index.ts for why: this keeps
 * the module structurally incapable of emitting a write statement, since no
 * ORM write-capable model class exists anywhere in this file tree.
 */
export const prodPool = new Pool({
  host: config.prodReadOnly.host,
  port: config.prodReadOnly.port,
  database: config.prodReadOnly.database,
  user: config.prodReadOnly.user,
  password: config.prodReadOnly.password,
  max: 5,
});
