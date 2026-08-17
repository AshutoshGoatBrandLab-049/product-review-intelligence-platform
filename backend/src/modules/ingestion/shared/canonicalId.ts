import { createHash } from "node:crypto";
import type { Platform } from "../../../types/unifiedReview.js";

/**
 * Deterministic canonical review ID — SHA-256 of the source's own composite
 * natural key, truncated to 128 bits (32 hex chars). Regenerating this from
 * the same (platform, sourceProductId, sourceReviewId) triple always yields
 * the same value, which is what makes ingestion upserts idempotent without a
 * separate lookup table.
 *
 * SHA-256 is chosen for fixed-length compactness and modern practice — not
 * because it fixes Flipkart's review_id collision risk. That risk lives in
 * the source's own input fields (author+day+rating+title aren't a unique key
 * for "one review"), not in digest strength; any collision-resistant hash is
 * equally safe here, since uniqueness is inherited structurally from the
 * source table's own unique constraint on (pid/product_id, review_id).
 */
export function computeCanonicalReviewId(
  platform: Platform,
  sourceProductId: string,
  sourceReviewId: string,
): string {
  // JSON.stringify of an array quotes and escapes each element, so this is
  // provably unambiguous regardless of field content — a bare ":" separator
  // would collide for e.g. (platform, "P:1", "R") vs (platform, "P", "1:R").
  const input = JSON.stringify([platform, sourceProductId, sourceReviewId]);
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}
