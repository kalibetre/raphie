import type { SessionSummary } from "@raphie/contracts";

export type Presence =
  "needs-you" | "setup" | "working" | "replied" | "available";

/** A conversation that waits on the owner: an approval or a question. */
export const needsYou = (session: SessionSummary) =>
  session.waiting || !!session.asking;

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
      label: replies === 1 ? "1 new reply" : `${replies} new replies`,
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
