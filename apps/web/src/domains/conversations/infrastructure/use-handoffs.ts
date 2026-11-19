import type { Handoff } from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBackend } from "../../../infrastructure/http/backend-context";

type Peer = { id: string; name: string };

type Handoffs = { targets: Peer[]; items: Handoff[] };

/** This bot's handoffs. BotBoundary owns the cache, so it resets per bot. */
export function useHandoffs() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["handoffs"],
    queryFn: () => workspace.api<Handoffs>("/api/handoffs"),
    // Open work changes without this bot doing anything; poll only then.
    refetchInterval: (current) =>
      current.state.data?.items.some((item) => item.status === "working")
        ? 3000
        : 15000,
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      workspace.api(`/api/handoffs/${encodeURIComponent(id)}/cancel`, {}),
    onSettled: () => client.invalidateQueries({ queryKey: ["handoffs"] }),
  });
  const setTargets = useMutation({
    mutationFn: (bots: string[]) =>
      workspace.api<{ targets: Peer[] }>(
        "/api/handoffs/targets",
        { bots },
        "PUT",
      ),
    onSuccess: ({ targets }) =>
      client.setQueryData<Handoffs>(["handoffs"], (current) =>
        current ? { ...current, targets } : current,
      ),
  });
  return { ...query, cancel, setTargets };
}
