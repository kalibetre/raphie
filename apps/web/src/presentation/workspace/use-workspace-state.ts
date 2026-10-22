import type {
  Page,
  RuntimeInfo,
  SessionObservation,
  SessionSummary,
  SessionTurn,
} from "@raphie/contracts";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ApiError, type Snapshot } from "../../infrastructure/http/api-client";
import { useBackend } from "../../infrastructure/http/backend-context";

/** Each observation replaces authoritative state; reconnect never replays a command. */
export function useLiveState(sessionId?: string, legacyId?: number) {
  const { workspace } = useBackend();
  const api = workspace.api;
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [sessionConnected, setSessionConnected] = useState(false);
  const [older, setOlder] = useState<Record<string, Page<SessionTurn>>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const info = useQuery({
    queryKey: ["runtime-info"],
    queryFn: () => api<RuntimeInfo>("/api/runtime"),
    refetchInterval: 5000,
  });
  const sessions = useInfiniteQuery({
    queryKey: ["sessions"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<SessionSummary>>(
        `/api/sessions?limit=100${pageParam ? `&after=${pageParam}` : ""}`,
      ),
    getNextPageParam: (page) => page.next,
  });
  const legacy = useQuery({
    queryKey: ["legacy-session", legacyId],
    enabled: !!legacyId,
    queryFn: () =>
      api<{ sessionId: string }>(`/api/sessions/legacy/${legacyId}`),
    retry: false,
  });
  const selectedId = sessionId ?? legacy.data?.sessionId;
  const selected = useQuery({
    queryKey: ["session", selectedId],
    enabled: !!selectedId,
    queryFn: () => api<SessionObservation>(`/api/sessions/${selectedId}`),
    retry: false,
  });
  useEffect(() => {
    return workspace.observe("/api/sessions/events", {
      open: () => setConnected(true),
      error: () => setConnected(false),
      message: (event) => {
        try {
          const page = JSON.parse(event.data) as Page<SessionSummary>;
          client.setQueryData<typeof sessions.data>(
            ["sessions"],
            (current) => ({
              pages: [page, ...(current?.pages.slice(1) ?? [])],
              pageParams: [null, ...(current?.pageParams.slice(1) ?? [])],
            }),
          );
        } catch {
          setConnected(false);
        }
      },
    });
  }, [client, workspace]);
  useEffect(() => {
    if (!selectedId || selected.error) return;
    setSessionConnected(false);
    return workspace.observe(`/api/sessions/${selectedId}/events`, {
      open: () => setSessionConnected(true),
      error: () => setSessionConnected(false),
      message: (event) => {
        try {
          const next = JSON.parse(event.data) as SessionObservation;
          const previous = client.getQueryData<SessionObservation>([
            "session",
            selectedId,
          ]);
          const visible = new Set(next.turns.map((turn) => turn.id));
          const shifted =
            previous?.turns.filter((turn) => !visible.has(turn.id)) ?? [];
          if (shifted.length)
            setOlder((current) => ({
              ...current,
              [selectedId]: {
                items: [...(current[selectedId]?.items ?? []), ...shifted],
                next: current[selectedId]
                  ? current[selectedId].next
                  : (previous?.nextBefore ?? null),
              },
            }));
          client.setQueryData(["session", selectedId], next);
        } catch {
          setConnected(false);
        }
      },
    });
  }, [selectedId, selected.error, client, workspace]);
  const data = useMemo<Snapshot | undefined>(() => {
    if (!info.data || !sessions.data) return undefined;
    const observation = selected.data;
    const byId = new Map<string, SessionSummary>();
    for (const session of sessions.data.pages.flatMap((page) => page.items))
      if (!byId.has(session.sessionId)) byId.set(session.sessionId, session);
    if (observation)
      byId.set(observation.session.sessionId, observation.session);
    const turns = new Map(
      [
        ...(selectedId ? (older[selectedId]?.items ?? []) : []),
        ...(observation?.turns ?? []),
      ].map((t) => [t.id, t]),
    );
    return {
      ...info.data,
      conversations: [...byId.values()],
      turns: [...turns.values()].sort((a, b) => a.createdAt - b.createdAt),
      toolApprovals: observation?.toolApprovals ?? [],
      live:
        selectedId && observation?.live
          ? { [selectedId]: observation.live }
          : {},
      activity: observation?.activity ?? [],
    };
  }, [info.data, sessions.data, selected.data, selectedId, older]);
  useEffect(() => {
    if (data) client.setQueryData(["runtime"], data);
  }, [client, data]);
  const nextBefore =
    selectedId && older[selectedId]
      ? older[selectedId].next
      : selected.data?.nextBefore;

  async function loadOlder() {
    if (!selectedId || !nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api<Page<SessionTurn>>(
        `/api/sessions/${selectedId}/history?before=${nextBefore}`,
      );
      setOlder((current) => ({
        ...current,
        [selectedId]: {
          items: [...page.items, ...(current[selectedId]?.items ?? [])],
          next: page.next,
        },
      }));
    } finally {
      setLoadingOlder(false);
    }
  }

  return {
    data,
    connected: connected && (!selectedId || sessionConnected),
    sessionMissing:
      (selected.error instanceof ApiError && selected.error.status === 404) ||
      (legacy.error instanceof ApiError && legacy.error.status === 404),
    isPending:
      info.isPending ||
      sessions.isPending ||
      (!!selectedId && selected.isPending) ||
      (!!legacyId && legacy.isPending),
    error:
      info.error ??
      sessions.error ??
      (selected.error instanceof ApiError && selected.error.status === 404
        ? null
        : selected.error),
    refetch: async () => {
      await Promise.all([
        info.refetch(),
        sessions.refetch(),
        ...(selectedId ? [selected.refetch()] : []),
      ]);
    },
    legacySessionId: legacy.data?.sessionId,
    nextBefore,
    loadOlder,
    loadingOlder,
    loadMoreSessions: () => sessions.fetchNextPage(),
    hasMoreSessions: sessions.hasNextPage,
  };
}
