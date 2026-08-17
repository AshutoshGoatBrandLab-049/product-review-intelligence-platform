import { useQuery } from "@tanstack/react-query";
import { getIngestionStatus, getAiUsage } from "@/api/endpoints/system";
import { queryKeys } from "@/api/queryKeys";

/** Admin-only endpoints — the hook itself doesn't enforce that (the backend
 * does, authoritatively); `enabled` lets a caller avoid firing a request
 * that will just 403 for a non-admin role. */
export function useIngestionStatus(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.ingestionStatus(),
    queryFn: ({ signal }) => getIngestionStatus(signal),
    enabled,
  });
}

export function useAiUsage(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.aiUsage(),
    queryFn: ({ signal }) => getAiUsage(signal),
    enabled,
  });
}
