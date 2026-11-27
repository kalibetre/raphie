import type { SessionSummary } from "@raphie/contracts";

export type Presence =
  "needs-you" | "setup" | "working" | "replied" | "available";

/** A conversation that waits on the owner: an approval or a question. */
export const needsYou = (session: SessionSummary) =>
  session.waiting || !!session.asking;

/**
 * What waits on the owner from one teammate, for the sidebar: how many
 * questions and how many approvals, what the newest is
 * about, and the conversation to open. That is the chat when its dock holds
 * them all (its own and its work items'); otherwise the newest conversation
 * it doesn't hold, such as a group's.
 */
export function waitingOnOwner(sessions: SessionSummary[]) {
  const waiting = sessions.filter(needsYou).sort((a, b) => b.lastAt - a.lastAt);
  const newest = waiting[0];
  if (!newest) return undefined;
  const chat = sessions.find((s) => s.chat);
  const elsewhere = waiting.find((s) => !s.chat && !s.work);
  return {
    // A conversation that waits counts as at least one of its kind.
    questions: waiting.reduce(
      (sum, s) => sum + (s.asking ? Math.max(s.questions, 1) : 0),
      0,
    ),
    approvals: waiting.reduce(
      (sum, s) => sum + (s.waiting ? Math.max(s.pending - s.questions, 1) : 0),
      0,
    ),
    title: newest.title,
    session: elsewhere ?? chat ?? newest,
    lastAt: newest.lastAt,
  };
}

/** The sidebar's line for what one teammate waits on the owner for. */
export function waitingLine(
  name: string,
  { questions, approvals }: { questions: number; approvals: number },
) {
  if (!approvals)
    return questions > 1
      ? `${name} has ${questions} questions`
      : `${name} has a question`;
  if (!questions)
    return approvals > 1
      ? `${name} needs ${approvals} OKs`
      : `${name} needs your OK`;
  return `${name} needs you for ${questions + approvals} things`;
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
