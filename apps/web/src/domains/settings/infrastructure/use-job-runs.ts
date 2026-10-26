import type { Page, ScheduledJobRun } from "@raphie/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

export function mergeJobRunPages(
  latest: ScheduledJobRun[] | undefined,
  pages: ScheduledJobRun[][],
) {
  const runs = new Map<string, ScheduledJobRun>();
  for (const run of [...(latest ?? []), ...pages.flat()])
    if (!runs.has(run.id)) runs.set(run.id, run);
  return [...runs.values()];
}

export function useJobRuns(jobId?: string) {
  const { workspace } = useBackend();
  const read = (before?: string | null) => {
    const search = new URLSearchParams();
    if (jobId) search.set("jobId", jobId);
    if (before) search.set("before", before);
    return workspace.api<Page<ScheduledJobRun>>(`/api/jobs/runs?${search}`);
  };
  const history = useInfiniteQuery({
    queryKey: ["job-runs", jobId ?? "all"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => read(pageParam),
    getNextPageParam: (page) => page.next,
    refetchInterval: (query) =>
      query.state.status === "error" ||
      (query.state.data?.pages.length ?? 0) > 1
        ? false
        : 5000,
  });
  // Once the reader has loaded older pages, poll only the head independently.
  // Keep displaced records from the original pages to avoid gaps on insertion.
  const multiplePages = (history.data?.pages.length ?? 0) > 1;
  const latest = useQuery({
    queryKey: ["job-runs-latest", jobId ?? "all"],
    queryFn: () => read(),
    enabled: multiplePages,
    refetchInterval: 5000,
  });
  const runs = mergeJobRunPages(
    multiplePages ? latest.data?.items : undefined,
    history.data?.pages.map((page) => page.items) ?? [],
  );
  return {
    ...history,
    runs,
    latestError: multiplePages && latest.isError,
    refetchLatest: latest.refetch,
  };
}
