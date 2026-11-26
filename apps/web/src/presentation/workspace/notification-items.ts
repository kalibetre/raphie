import type { ScheduledJobRun, SessionSummary } from "@raphie/contracts";

export type NotificationBot = { id: string; name: string };

type Job = { bot: NotificationBot; run: ScheduledJobRun };

/**
 * What waits for the owner beyond each bot's chat: an approval to give, or
 * a scheduled job's run. New messages show on the bot in the sidebar.
 */
export type NotificationItem = {
  key: string;
  bot: NotificationBot;
  kind: "approval" | "job";
  time: number;
  session?: SessionSummary;
  run?: ScheduledJobRun;
};

export function notificationItems(
  bots: NotificationBot[],
  byBot: Map<string, SessionSummary[]>,
  jobs: Job[],
) {
  const items: NotificationItem[] = [];
  for (const bot of bots)
    for (const session of byBot.get(bot.id) ?? [])
      if (session.waiting)
        items.push({
          key: `approval:${bot.id}:${session.sessionId}`,
          bot,
          kind: "approval",
          time: session.lastAt,
          session,
        });
  for (const { bot, run } of jobs)
    items.push({
      key: `job:${bot.id}:${run.id}`,
      bot,
      kind: "job",
      time: run.finishedAt ?? run.startedAt,
      run,
    });
  items.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key));
  return items;
}
