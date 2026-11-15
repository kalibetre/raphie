import type {
  ProviderSignIn,
  RuntimeSettings,
  StartProviderSignIn,
} from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";

/**
 * One subscription sign-in: started, then followed by polling until it
 * connects, fails or is cancelled. Answers and cancelling go to the runtime,
 * which runs the provider's own sign-in.
 */
export function useProviderSignIn(onConnected: () => void) {
  const { workspace } = useBackend();
  const api = workspace.api;
  const client = useQueryClient();
  const [id, setId] = useState<string>();
  const start = useMutation({
    mutationFn: (input: StartProviderSignIn) =>
      api<ProviderSignIn>("/api/settings/sign-ins", input),
    onSuccess: (signIn) => {
      client.setQueryData(["provider-sign-in", signIn.id], signIn);
      setId(signIn.id);
    },
  });
  const state = useQuery({
    enabled: !!id,
    queryKey: ["provider-sign-in", id],
    queryFn: () =>
      api<ProviderSignIn>(`/api/settings/sign-ins/${encodeURIComponent(id!)}`),
    // Polled while it waits; the owner may be finishing it in another tab.
    refetchInterval: (query) =>
      query.state.data?.status === "waiting" ? 1000 : false,
  });
  const signIn = id ? state.data : undefined;
  const answer = useMutation({
    mutationFn: (input: { promptId: string; value: string }) =>
      api<ProviderSignIn>(
        `/api/settings/sign-ins/${encodeURIComponent(id!)}/answer`,
        input,
      ),
    onSuccess: (next) => client.setQueryData(["provider-sign-in", id], next),
  });
  const cancel = useMutation({
    mutationFn: () =>
      api<ProviderSignIn>(
        `/api/settings/sign-ins/${encodeURIComponent(id!)}/cancel`,
        {},
      ),
    onSuccess: (next) => client.setQueryData(["provider-sign-in", id], next),
  });
  const connected = signIn?.status === "connected";
  useEffect(() => {
    if (!connected) return;
    // The new connection and its models.
    void client
      .fetchQuery({
        queryKey: ["runtime-settings"],
        queryFn: () => api<RuntimeSettings>("/api/settings"),
        staleTime: 0,
      })
      .then(onConnected);
    void client.invalidateQueries({ queryKey: ["runtime-info"] });
  }, [connected, client, api, onConnected]);
  return {
    signIn,
    start,
    answer,
    cancel,
    reset: () => {
      setId(undefined);
      start.reset();
      answer.reset();
    },
  };
}
