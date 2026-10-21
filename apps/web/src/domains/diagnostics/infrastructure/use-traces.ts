import type { TraceDiagnostics } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";

import { api } from "../../../infrastructure/http/api-client";

export function useTraces(hours: 1 | 6 | 24) {
  return useQuery({
    queryKey: ["diagnostics", "traces", hours],
    queryFn: () =>
      api<TraceDiagnostics>(`/api/diagnostics/traces?hours=${hours}`),
    refetchInterval: 5000,
    retry: false,
  });
}
