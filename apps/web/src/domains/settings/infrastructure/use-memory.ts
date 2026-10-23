import type { MemoryStatus, SaveMemoryConfiguration } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useMemory() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["memory-settings"],
    queryFn: () => workspace.api<MemoryStatus>("/api/memory"),
    retry: false,
  });
  const update = useMutation({
    mutationFn: (input: SaveMemoryConfiguration) =>
      workspace.api<MemoryStatus>("/api/memory", input),
    onSuccess: async (status) => {
      client.setQueryData(["memory-settings"], status);
      await query.refetch();
    },
  });
  return { ...query, update };
}
