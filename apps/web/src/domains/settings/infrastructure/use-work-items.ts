import type { WorkItem } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";
import type { WorkChange } from "../application/work-draft";

/** The bot's open work items, or its closed ones, refreshed while shown. */
export function useWorkItems(closed: boolean) {
  const { workspace } = useBackend();
  return useQuery({
    queryKey: ["work-items", closed ? "closed" : "open"],
    queryFn: () =>
      workspace.api<{ items: WorkItem[] }>(
        `/api/work-items${closed ? "?status=closed" : ""}`,
      ),
    refetchInterval: 5000,
  });
}

/** Opens an item (without `id`) or changes one; both lists refresh after. */
export function useWorkChange() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: WorkChange }) =>
      id
        ? workspace.api<WorkItem>(
            `/api/work-items/${encodeURIComponent(id)}`,
            input,
            "PATCH",
          )
        : workspace.api<WorkItem>("/api/work-items", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["work-items"] }),
  });
}
