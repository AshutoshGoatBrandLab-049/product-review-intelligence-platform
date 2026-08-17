import { QueryTypes } from "sequelize";
import { appSequelize } from "../../database/appStore/client.js";
import { config } from "../../config/index.js";
import type { Platform } from "../../types/unifiedReview.js";

export interface CandidateReview {
  canonicalReviewId: string;
  platform: Platform;
  rating: number;
  title: string | null;
  reviewText: string | null;
  contentHash: string;
  isStale: boolean;
}

export interface CandidateSummary {
  totalReviews: number;
  alreadyClassifiedCount: number;
  staleCount: number;
  newCount: number;
  candidateCount: number; // staleCount + newCount — what a real run would actually process
}

export interface CandidateFilter {
  platform?: Platform;
  /** Phase 4.1 §4 — scopes candidate selection to an explicit, pre-curated
   * set of reviews (e.g. a controlled smoke-test sample), reusing the exact
   * same staleness/new logic as an unscoped run — never a separate code path. */
  canonicalReviewIds?: string[];
}

/**
 * Phase 4 §7 — staleness reuses the exact mechanism Track B already uses for
 * change detection: normalized_reviews.content_hash vs. the hash recorded at
 * classification time. A review is a candidate if it has never been
 * classified (no review_sentiment row) OR the review's content has changed
 * since it was classified (content_hash mismatch) — never re-selected just
 * because updatedAt/source_updated_at changed, since content_hash itself
 * already ignores those fields (Phase 1 design, unchanged here).
 */
function candidateWhereClause(filter: CandidateFilter): string {
  const conditions = [`(rs.canonical_review_id IS NULL OR rs.content_hash_at_classification != nr.content_hash)`];
  if (filter.platform) conditions.push(`nr.platform = :platform`);
  if (filter.canonicalReviewIds) conditions.push(`nr.canonical_review_id IN (:canonicalReviewIds)`);
  return conditions.join(" AND ");
}

/**
 * Keyset pagination on canonical_review_id (the PK — stable, globally
 * unique, indexed), NOT OFFSET. This matters specifically because the
 * pipeline WRITES results as it goes: a successfully-classified review drops
 * out of the candidate pool immediately, which would silently skip rows
 * under OFFSET-based paging (offset N would then point past unprocessed
 * rows). Same reasoning as Track A's id-keyset cursor (Phase 1 design),
 * reused here rather than reintroducing the bug OFFSET pagination has.
 */
export async function findCandidateReviews(
  filter: CandidateFilter,
  limit: number,
  afterCanonicalReviewId: string = "",
): Promise<CandidateReview[]> {
  const schema = config.appStore.schema;
  const rows = await appSequelize.query<{
    canonical_review_id: string;
    platform: Platform;
    rating: number;
    title: string | null;
    review_text: string | null;
    content_hash: string;
    is_stale: boolean;
  }>(
    `SELECT nr.canonical_review_id, nr.platform, nr.rating, nr.title, nr.review_text, nr.content_hash,
            (rs.canonical_review_id IS NOT NULL) AS is_stale
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = nr.canonical_review_id
     WHERE ${candidateWhereClause(filter)}
       AND nr.canonical_review_id > :afterId
     ORDER BY nr.canonical_review_id ASC
     LIMIT :limit`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        platform: filter.platform ?? "",
        canonicalReviewIds: filter.canonicalReviewIds ?? [],
        afterId: afterCanonicalReviewId,
        limit,
      },
    },
  );

  return rows.map((r) => ({
    canonicalReviewId: r.canonical_review_id,
    platform: r.platform,
    rating: r.rating,
    title: r.title,
    reviewText: r.review_text,
    contentHash: r.content_hash,
    isStale: r.is_stale,
  }));
}

export async function summarizeCandidates(filter: CandidateFilter = {}): Promise<CandidateSummary> {
  const schema = config.appStore.schema;
  const scopeCondition = [
    filter.platform ? "nr.platform = :platform" : null,
    filter.canonicalReviewIds ? "nr.canonical_review_id IN (:canonicalReviewIds)" : null,
  ]
    .filter(Boolean)
    .join(" AND ") || "true";
  const replacements = { platform: filter.platform ?? "", canonicalReviewIds: filter.canonicalReviewIds ?? [] };

  const [totalRow] = await appSequelize.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".normalized_reviews nr WHERE ${scopeCondition}`,
    { type: QueryTypes.SELECT, replacements },
  );

  const [breakdownRow] = await appSequelize.query<{ stale_count: string; new_count: string }>(
    `SELECT
       count(*) FILTER (WHERE rs.canonical_review_id IS NOT NULL AND rs.content_hash_at_classification != nr.content_hash)::text AS stale_count,
       count(*) FILTER (WHERE rs.canonical_review_id IS NULL)::text AS new_count
     FROM "${schema}".normalized_reviews nr
     LEFT JOIN "${schema}".review_sentiment rs ON rs.canonical_review_id = nr.canonical_review_id
     WHERE ${scopeCondition}`,
    { type: QueryTypes.SELECT, replacements },
  );

  const totalReviews = Number(totalRow!.count);
  const staleCount = Number(breakdownRow!.stale_count);
  const newCount = Number(breakdownRow!.new_count);
  const candidateCount = staleCount + newCount;

  return {
    totalReviews,
    alreadyClassifiedCount: totalReviews - candidateCount,
    staleCount,
    newCount,
    candidateCount,
  };
}
