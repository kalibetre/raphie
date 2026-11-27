import type { SessionSummary } from "@raphie/contracts";

export type Presence =
  "needs-you" | "setup" | "working" | "replied" | "available";

/** A conversation that waits on the owner: an approval or a question. */
export const needsYou = (session: SessionSummary) =>
  session.waiting || !!session.asking;

/**
 * What waits on the owner from one teammate, for the sidebar: how many
 * questions and approvals, whether one is a question, and the conversation
 * to open, its chat when it has one, where the dock asks them all.
 */
export function waitingOnOwner(sessions: SessionSummary[]) {
  const waiting = sessions.filter(needsYou);
  if (!waiting.length) return undefined;
  return {
    count: waiting.reduce((sum, s) => sum + Math.max(s.pending ?? 1, 1), 0),
    asking: waiting.some((s) => s.asking),
    session:
      sessions.find((s) => s.chat) ??
      [...waiting].sort((a, b) => b.lastAt - a.lastAt)[0]!,
    lastAt: Math.max(...waiting.map((s) => s.lastAt)),
  };
}

/** The sidebar's line for what one teammate waits on the owner for. */
export function waitingLine(name: string, count: number, asking: boolean) {
  if (count > 1) return `${name} has ${count} questions`;
  return `${name} ${asking ? "has a question" : "needs your OK"}`;
}

/** What a teammate is doing, from its open conversations. */
export function presence(
  sessions: SessionSummary[],
  unread: (session: SessionSummary) => number,
  /** Known to have no model it can reply with. */
  unready = false,
): { state: Presence; label: string } {
  if (sessions.some(needsYou))
    return { state: "needs-you", label: "Needs you" };
  if (unready) return { state: "setup", label: "Needs setup" };
  if (sessions.some((s) => s.working))
    return { state: "working", label: "Working" };
  const replies = sessions.filter((s) => unread(s) > 0).length;
  if (replies)
    return {
      state: "replied",
      label: replies === 1 ? "1 new message" : `${replies} new messages`,
    };
  return { state: "available", label: "Available" };
}

/** Where this workspace runs, in the words the sidebar's footer uses. */
export function runtimePlace(href: string) {
  try {
    const host = new URL(href).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host)
      ? "This computer"
      : host;
  } catch {
    return "This computer";
  }
}
