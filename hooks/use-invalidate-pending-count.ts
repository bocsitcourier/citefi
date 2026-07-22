import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export const PENDING_COUNT_KEY = ["/api/admin/pending-count"] as const;

/**
 * Returns a stable callback that immediately invalidates the admin
 * pending-approvals badge query.  Import and call this from any mutation
 * that changes a user's pending status (approve, reject, bulk-actions, etc.)
 * so the sidebar badge stays in sync regardless of which page triggers the
 * status change.
 */
export function useInvalidatePendingCount() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: PENDING_COUNT_KEY });
  }, [queryClient]);
}
