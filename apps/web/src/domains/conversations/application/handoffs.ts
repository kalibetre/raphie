import type { Handoff, HandoffRequest } from "@raphie/contracts";

/** The open handoffs a session started, for the bots working on them. */
export function openHandoffs(items: readonly Handoff[], sessionId?: string) {
  return items.filter(
    (item) => item.status === "working" && item.fromSessionId === sessionId,
  );
}

export type DelegateGroup = {
  bot: Handoff["to"];
  handoffs: Handoff[];
  waiting: boolean;
};

/** Bots working for a session, the ones waiting for the owner first. */
export function delegateGroups(open: readonly Handoff[]): DelegateGroup[] {
  const groups = new Map<string, DelegateGroup>();
  for (const handoff of open) {
    const group = groups.get(handoff.to.id) ?? {
      bot: handoff.to,
      handoffs: [],
      waiting: false,
    };
    group.handoffs.push(handoff);
    group.waiting ||= !!handoff.waiting;
    groups.set(handoff.to.id, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.waiting) - Number(a.waiting),
  );
}

/** One line for the composer: who needs the owner, or who is working. */
export function delegateLabel(groups: readonly DelegateGroup[]) {
  const tasks = groups.reduce((sum, group) => sum + group.handoffs.length, 0);
  const waiting = groups.find((group) => group.waiting);
  if (waiting) {
    const others = groups
      .flatMap((group) => group.handoffs)
      .filter((handoff) => !handoff.waiting).length;
    return `${waiting.bot.name} needs you${others ? ` · ${others} more working` : ""}`;
  }
  if (groups.length === 1)
    return `${groups[0]!.bot.name} is on it${tasks > 1 ? ` · ${tasks} tasks` : ""}`;
  return `${groups.length} bots on it · ${tasks} tasks`;
}

export type SentRequest = {
  handoff: Handoff;
  request: HandoffRequest;
  /** 0 for the first brief, then each follow-up in order. */
  index: number;
};

/** The briefs a turn sent, so their cards sit under its reply. */
export function requestsFromTurn(items: readonly Handoff[], turnId: string) {
  return items.flatMap((handoff) =>
    handoff.requests.flatMap((request, index): SentRequest[] =>
      request.fromTurnId === turnId ? [{ handoff, request, index }] : [],
    ),
  );
}

/** A request's own status: the handoff's waiting flag applies to the open one. */
export function requestStatus(sent: SentRequest) {
  if (sent.request.outcome) return sent.request.outcome;
  return sent.handoff.waiting ? "waiting" : "working";
}

export const statusLabel = {
  working: "Working",
  waiting: "Needs your approval",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;
