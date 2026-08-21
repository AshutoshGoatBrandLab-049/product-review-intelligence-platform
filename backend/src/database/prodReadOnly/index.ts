/**
 * database/prodReadOnly — the ENTIRE exported surface, nothing else.
 *
 * Security layer 2: no generic query executor, no dynamic table name, ever.
 * Every query lives behind one of these four functions, each referencing
 * exactly one of the two approved tables. `Object.keys()` on this module's
 * exports must equal exactly these four names — see
 * tests/security/prodReadOnlySurface.test.ts.
 *
 * These functions read through appSequelize (the application's single
 * connection), because source and canonical tables are co-located in one
 * database and one schema. A second raw-`pg` pool (client.ts, `prodPool`) used
 * to exist for a separate read-only connection; it was removed after the
 * architecture unified, since nothing imported it — which also meant the DATE
 * type parser it registered never ran. That parser turned out to be redundant:
 * verified against the live database, review_date already arrives as the string
 * "YYYY-MM-DD" through Sequelize, so no local-midnight day shift is possible.
 */
import * as flipkart from "./flipkartReviewsRepo.js";
import * as myntra from "./myntraReviewsRepo.js";
import type { RawFlipkartReview, RawMyntraReview } from "../../types/unifiedReview.js";

export async function getFlipkartReviewsPage(
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  return flipkart.getFlipkartReviewsPage(afterId, limit);
}

export async function getFlipkartReviewsByDateWindow(
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  return flipkart.getFlipkartReviewsByDateWindow(windowStart, afterId, limit);
}

export async function getMyntraReviewsPage(
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  return myntra.getMyntraReviewsPage(afterId, limit);
}

export async function getMyntraReviewsByDateWindow(
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  return myntra.getMyntraReviewsByDateWindow(windowStart, afterId, limit);
}
