import type { SessionSummary } from "@raphie/contracts";

export type ReplyLedger = Record<string, Record<string, number>>;

export function unreadReplies(
  ledger: ReplyLedger,
  botId: string,
  session: SessionSummary,
) {
  return Math.max(
    0,
    (session.replyCount ?? 0) - (ledger[botId]?.[session.sessionId] ?? 0),
  );
}

export function readReplies(
  ledger: ReplyLedger,
  botId: string,
  sessionId: string,
  count: number,
): ReplyLedger {
  const previous = ledger[botId]?.[sessionId] ?? 0;
  if (count <= previous) return ledger;
  return { ...ledger, [botId]: { ...ledger[botId], [sessionId]: count } };
}

export function parseReplyLedger(value: string | null): ReplyLedger {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([bot, sessions]) => [
        bot,
        sessions && typeof sessions === "object" && !Array.isArray(sessions)
          ? Object.fromEntries(
              Object.entries(sessions)
                .filter(
                  ([, count]) =>
                    Number.isSafeInteger(count) && Number(count) >= 0,
                )
                .map(([id, count]) => [id, Number(count)]),
            )
          : {},
      ]),
    );
  } catch {
    return {};
  }
}
