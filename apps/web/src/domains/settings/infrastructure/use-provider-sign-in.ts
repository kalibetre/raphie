import type {
  ProviderSignIn,
  RuntimeSettings,
  StartProviderSignIn,
} from "@raphie/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
  // A tab opened during the click, while the browser still allows it, and
  // sent to the sign-in page once the runtime reports it.
  const tab = useRef<Window | null>(null);
  const settleTab = (url?: string) => {
    const opened = tab.current;
    tab.current = null;
    if (!opened || opened.closed) return;
    if (!url) return opened.close();
    opened.opener = null;
    opened.location.href = url;
  };
  const start = useMutation({
    mutationFn: (input: StartProviderSignIn) =>
      api<ProviderSignIn>("/api/settings/sign-ins", input),
    onSuccess: (signIn) => {
      client.setQueryData(["provider-sign-in", signIn.id], signIn);
      setId(signIn.id);
    },
    onError: () => settleTab(),
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
  const link = signIn?.events.find((e) => e.type === "auth_url")?.url;
  // Settled once the sign-in says anything: its page, or no page to open.
  const reported =
    !!signIn &&
    (signIn.status !== "waiting" || !!signIn.prompt || !!signIn.events.length);

  useEffect(() => {
    if (reported) settleTab(signIn?.status === "waiting" ? link : undefined);
  }, [reported, link, signIn?.status]);
  // Leaving the form closes a tab that never got its page.
  useEffect(() => () => settleTab(), []);
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
    /**
     * Starts a sign-in from a click. Its page opens in a new tab by itself,
     * so one press is enough.
     */
    begin: (input: StartProviderSignIn) => {
      settleTab();
      tab.current = window.open("about:blank", "_blank");
      start.mutate(input);
    },
    answer,
    cancel,
    reset: () => {
      setId(undefined);
      start.reset();
      answer.reset();
    },
  };
}
