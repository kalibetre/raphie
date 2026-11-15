import type { Page, SessionSummary } from "@raphie/contracts";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  mergeReplyLedgers,
  parseReplyLedger,
  readReplies,
  unreadReplies,
} from "../../domains/conversations/application/reply-ledger";
import { useBots } from "../../domains/settings/infrastructure/use-bots";
import { useBackend } from "../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../infrastructure/preferences/storage";

/** Current-bot updates use its existing stream; other bots poll without holding browser connections. */
export function useBotInbox(currentSessions?: SessionSummary[]) {
  const { workspace, backend } = useBackend();
  const bots = useBots();
  const ids = useMemo(
    () => bots.data?.items.map((b) => b.id) ?? [],
    [bots.data],
  );
  const key = `raphie:read-replies:${encodeURIComponent(workspace.url)}`;
  const [ledger, setLedger] = useState(() => parseReplyLedger(readLocal(key)));
  // Backend-wide cache: badges survive bot changes. The current bot is fed
  // from its live stream below instead of being polled.
  const summaries = useQueries(
    {
      queries: ids.map((id) => ({
        queryKey: ["bot-inbox", id],
        queryFn: () =>
          backend.api<Page<SessionSummary>>(
            `/api/bots/${id}/sessions?limit=100`,
          ),
        enabled: id !== workspace.botId,
        refetchInterval: 15000,
      })),
    },
    backend.queries,
  );
  useEffect(() => {
    if (currentSessions)
      backend.queries.setQueryData<Page<SessionSummary>>(
        ["bot-inbox", workspace.botId],
        (page) => ({ items: currentSessions, next: page?.next ?? null }),
      );
  }, [backend, workspace.botId, currentSessions]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== key) return;
      setLedger((current) => {
        const stored = readLocal(key);
        const next = mergeReplyLedgers(
          current,
          parseReplyLedger(stored),
          parseReplyLedger(event.newValue),
        );
        const serialized = JSON.stringify(next);
        if (stored !== serialized) writeLocal(key, serialized);
        return serialized === JSON.stringify(current) ? current : next;
      });
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  // The highest count already sent per bot and session, so each read is
  // reported to the runtime once.
  const reported = useRef(new Map<string, number>());
  const markRead = useCallback(
    (botId: string, sessionId: string, count: number) => {
      const shared =
        backend.queries
          .getQueryData<Page<SessionSummary>>(["bot-inbox", botId])
          ?.items.find((s) => s.sessionId === sessionId)?.readReplyCount ?? 0;
      const sent = reported.current.get(`${botId}:${sessionId}`) ?? 0;
      if (count > Math.max(shared, sent)) {
        reported.current.set(`${botId}:${sessionId}`, count);
        // Shared with the other clients; the local cursor below already
        // holds it if the runtime cannot be reached.
        void backend
          .api(
            `/api/bots/${encodeURIComponent(botId)}/sessions/${encodeURIComponent(sessionId)}/read`,
            { replyCount: count },
          )
          .catch(() => reported.current.delete(`${botId}:${sessionId}`));
      }
      setLedger((current) => {
        const next = mergeReplyLedgers(
          readReplies(current, botId, sessionId, count),
          parseReplyLedger(readLocal(key)),
        );
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        writeLocal(key, JSON.stringify(next));
        return next;
      });
    },
    [key, backend],
  );
  const byBot = new Map(
    ids.map((id, i) => [
      id,
      id === workspace.botId
        ? (currentSessions ?? summaries[i]?.data?.items ?? [])
        : (summaries[i]?.data?.items ?? []),
    ]),
  );
  return {
    bots,
    byBot,
    markRead,
    unread: (botId: string, session: SessionSummary) =>
      unreadReplies(ledger, botId, session),
  };
}
