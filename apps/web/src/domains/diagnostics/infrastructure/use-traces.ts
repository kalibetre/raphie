import type { TraceDiagnostics } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useTraces(hours: 1 | 6 | 24) {
  const { workspace } = useBackend();
  const api = workspace.api;
  return useQuery({
    queryKey: ["diagnostics", "traces", hours],
    queryFn: () =>
      api<TraceDiagnostics>(`/api/diagnostics/traces?hours=${hours}`),
    refetchInterval: 5000,
    retry: false,
  });
}
