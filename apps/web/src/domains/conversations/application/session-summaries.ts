import type { ClientWorkspace, SessionSummary } from "@raphie/contracts";

export function getSessionSummaries(
  snapshot: ClientWorkspace | undefined,
  filter: string,
  _now: number,
) {
  return (snapshot?.conversations ?? [])
    .filter((session) =>
      session.title.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => b.lastAt - a.lastAt);
}

export type { SessionSummary };
