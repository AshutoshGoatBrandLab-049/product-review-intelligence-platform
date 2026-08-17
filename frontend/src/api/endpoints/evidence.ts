import { apiGet } from "../client";
import type { EvidenceReviewsResponse } from "@/types/api";

export function getEvidenceReviews(canonicalReviewIds: string[], signal?: AbortSignal) {
  const query = { canonicalReviewIds: canonicalReviewIds.join(",") };
  return apiGet<EvidenceReviewsResponse>(`/v1/evidence/reviews`, { query, signal });
}
