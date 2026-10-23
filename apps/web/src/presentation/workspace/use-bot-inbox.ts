import type { Page, SessionSummary } from "@raphie/contracts";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
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

/** One summary stream per bot, rather than observing every conversation. */
export function useBotInbox() {
  const { workspace } = useBackend();
  const bots = useBots();
  const client = useQueryClient();
  const ids = useMemo(
    () => bots.data?.items.map((b) => b.id) ?? [],
    [bots.data],
  );
  const key = `raphie:read-replies:${encodeURIComponent(workspace.url)}`;
  const [ledger, setLedger] = useState(() => parseReplyLedger(readLocal(key)));
  const summaries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["bot-inbox", id],
      queryFn: () =>
        workspace.api<Page<SessionSummary>>(
          `/api/bots/${id}/sessions?limit=100`,
        ),
      refetchInterval: 30000,
    })),
  });
  useEffect(() => {
    const stop = ids.map((id) =>
      workspace.observe(`/api/bots/${id}/sessions/events`, {
        message: (event) => {
          try {
            client.setQueryData(
              ["bot-inbox", id],
              JSON.parse(event.data) as Page<SessionSummary>,
            );
          } catch {
            void client.invalidateQueries({ queryKey: ["bot-inbox", id] });
          }
        },
      }),
    );
    return () => stop.forEach((close) => close());
  }, [ids, client, workspace]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setLedger(parseReplyLedger(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  const markRead = useCallback(
    (botId: string, sessionId: string, count: number) => {
      setLedger((current) => {
        const next = readReplies(current, botId, sessionId, count);
        if (next !== current) writeLocal(key, JSON.stringify(next));
        return next;
      });
    },
    [key],
  );
  const byBot = new Map(
    ids.map((id, i) => [id, summaries[i]?.data?.items ?? []]),
  );
  return {
    bots,
    byBot,
    markRead,
    unread: (botId: string, session: SessionSummary) =>
      unreadReplies(ledger, botId, session),
  };
}
