import type { SessionSummary } from "@raphie/contracts";

export type { SessionSummary };

export function sessionPreview(text: string) {
  return text
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Conversations with new replies first; the order within each group stays. */
export function byNewReplies(
  sessions: SessionSummary[],
  unread: (session: SessionSummary) => number,
) {
  return [
    ...sessions.filter((s) => unread(s) > 0),
    ...sessions.filter((s) => unread(s) === 0),
  ];
}

/** Whether a conversation's title matches what was typed in a search box. */
export function titleMatches(session: SessionSummary, query: string) {
  return session.title.toLowerCase().includes(query.trim().toLowerCase());
}
