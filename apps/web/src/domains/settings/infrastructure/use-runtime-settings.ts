import type { RuntimeSettings, UpdateRuntimeSettings } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useRuntimeSettings() {
  const { workspace } = useBackend();
  const api = workspace.api;
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["runtime-settings"],
    queryFn: () => api<RuntimeSettings>("/api/settings"),
    retry: false,
  });
  const update = useMutation({
    mutationFn: (input: UpdateRuntimeSettings) =>
      api<RuntimeSettings>("/api/settings", input),
    onSuccess: (settings) => {
      client.setQueryData(["runtime-settings"], settings);
      void client.invalidateQueries({ queryKey: ["runtime-info"] });
    },
  });
  return { ...query, update };
}
