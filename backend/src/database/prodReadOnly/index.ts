/**
 * database/prodReadOnly — the ENTIRE exported surface, nothing else.
 *
 * Security layer 2: no generic query executor, no dynamic table name, ever.
 * Every query lives behind one of these four functions, each referencing
 * exactly one of the two approved tables via a fixed, hardcoded literal.
 * `Object.keys()` on this module's exports must equal exactly these four
 * names — see tests/security/prodReadOnlySurface.test.ts.
 */
import { prodPool } from "./client.js";
import * as flipkart from "./flipkartReviewsRepo.js";
import * as myntra from "./myntraReviewsRepo.js";
import type { RawFlipkartReview, RawMyntraReview } from "../../types/unifiedReview.js";

export async function getFlipkartReviewsPage(
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  return flipkart.getFlipkartReviewsPage(prodPool, afterId, limit);
}

export async function getFlipkartReviewsByDateWindow(
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawFlipkartReview[]> {
  return flipkart.getFlipkartReviewsByDateWindow(prodPool, windowStart, afterId, limit);
}

export async function getMyntraReviewsPage(
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  return myntra.getMyntraReviewsPage(prodPool, afterId, limit);
}

export async function getMyntraReviewsByDateWindow(
  windowStart: string,
  afterId: number,
  limit: number,
): Promise<RawMyntraReview[]> {
  return myntra.getMyntraReviewsByDateWindow(prodPool, windowStart, afterId, limit);
}
