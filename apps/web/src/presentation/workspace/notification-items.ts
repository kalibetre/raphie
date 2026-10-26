import type { ScheduledJobRun, SessionSummary } from "@raphie/contracts";

export type NotificationBot = { id: string; name: string };

type Job = { bot: NotificationBot; run: ScheduledJobRun };

export type NotificationItem = {
  key: string;
  bot: NotificationBot;
  kind: "reply" | "approval" | "job";
  time: number;
  session?: SessionSummary;
  run?: ScheduledJobRun;
  unread?: number;
};

export function notificationItems(
  bots: NotificationBot[],
  byBot: Map<string, SessionSummary[]>,
  unread: (botId: string, session: SessionSummary) => number,
  jobs: Job[],
) {
  const items: NotificationItem[] = [];
  let merged = 0;
  for (const bot of bots)
    for (const session of byBot.get(bot.id) ?? []) {
      const count = unread(bot.id, session);
      if (session.waiting)
        items.push({
          key: `approval:${bot.id}:${session.sessionId}`,
          bot,
          kind: "approval",
          time: session.lastAt,
          session,
        });
      const match =
        count === 1 &&
        session.replyTurnId &&
        jobs.find(
          ({ bot: owner, run }) =>
            owner.id === bot.id &&
            run.status === "completed" &&
            run.sessionId === session.sessionId &&
            run.turnId === session.replyTurnId,
        );
      if (count && !match)
        items.push({
          key: `reply:${bot.id}:${session.sessionId}`,
          bot,
          kind: "reply",
          time: session.lastAt,
          session,
          unread: count,
        });
      if (match) merged++;
    }
  for (const { bot, run } of jobs) {
    const session = (byBot.get(bot.id) ?? []).find(
      (s) =>
        s.sessionId === run.sessionId &&
        s.replyTurnId === run.turnId &&
        unread(bot.id, s) === 1 &&
        run.status === "completed",
    );
    items.push({
      key: `job:${bot.id}:${run.id}`,
      bot,
      kind: "job",
      time: run.finishedAt ?? run.startedAt,
      run,
      session,
    });
  }
  items.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key));
  return { items, merged };
}
