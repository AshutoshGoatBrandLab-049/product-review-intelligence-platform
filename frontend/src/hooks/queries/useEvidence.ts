import { useQuery } from "@tanstack/react-query";
import { getEvidenceReviews } from "@/api/endpoints/evidence";
import { queryKeys } from "@/api/queryKeys";

export function useEvidenceReviews(canonicalReviewIds: string[], enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.evidenceReviews(canonicalReviewIds),
    queryFn: ({ signal }) => getEvidenceReviews(canonicalReviewIds, signal),
    enabled: enabled && canonicalReviewIds.length > 0,
  });
}
