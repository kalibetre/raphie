import type { Page, ScheduledJobRun } from "@raphie/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function useJobRuns(jobId?: string) {
  const { workspace } = useBackend();
  return useInfiniteQuery({
    queryKey: ["job-runs", jobId ?? "all"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (jobId) search.set("jobId", jobId);
      if (pageParam) search.set("before", pageParam);
      return workspace.api<Page<ScheduledJobRun>>(`/api/jobs/runs?${search}`);
    },
    getNextPageParam: (page) => page.next,
    refetchInterval: 5000,
  });
}
