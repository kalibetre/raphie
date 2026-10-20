import type { WorkspaceSnapshot as Snapshot } from "@raphie/contracts";

export function getSessionSummaries(
  snapshot: Snapshot | undefined,
  filter: string,
  now: number,
) {
  if (!snapshot) return [];
  return snapshot.conversations
    .map((c) => {
      const turns = snapshot.turns.filter((t) => t.conversationId === c.id);
      return {
        ...c,
        lastAt: Math.max(
          c.createdAt,
          ...turns.map((t) => t.createdAt),
          ...snapshot.activity
            .filter((e) => e.conversationId === c.id)
            .map((e) => e.at),
        ),
        working: turns.some((t) => t.status === "pending"),
        failed: turns.at(-1)?.status === "error",
        preview:
          turns.at(-1)?.answer ?? turns.at(-1)?.text ?? "No messages yet",
        turnCount: turns.length,
        waiting: snapshot.toolApprovals.some(
          (a) =>
            a.conversationId === c.id &&
            a.status === "pending" &&
            a.expiresAt > now,
        ),
      };
    })
    .filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b.lastAt - a.lastAt);
}

export type SessionSummary = ReturnType<typeof getSessionSummaries>[number];
