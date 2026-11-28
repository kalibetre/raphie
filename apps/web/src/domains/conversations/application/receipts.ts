import type {
  ActivityEvent,
  BackgroundRequest,
  SessionAsk,
  Turn,
} from "@raphie/contracts";

/** What placing a reply needs of its turn. */
type SaidTurn = Pick<Turn, "id" | "createdAt" | "work" | "scheduled">;

/** A receipt of a background question the owner answered, or that lapsed. */
export type Receipt = { ask: SessionAsk; title: string; at: number };

/**
 * When a turn's reply was said: its last model call. A job's post has no
 * model call: it was said when it was posted.
 */
export function saidAt(
  turn: SaidTurn,
  activity: readonly Pick<ActivityEvent, "at" | "runId" | "type">[],
) {
  return (
    activity.findLast(
      (e) => e.runId === turn.id && e.type === "model.completed",
    )?.at ?? (turn.work || turn.scheduled ? turn.createdAt : undefined)
  );
}

/**
 * Where each receipt of the background work's settled questions goes in
 * the conversation: above the first message said at or after it was
 * settled, by message id, and the rest after the last message. The owner's
 * message was said when it was sent, and the reply when it was written, so
 * a reply written after an answer goes below that answer's receipt.
 */
export function placeReceipts(
  background: readonly BackgroundRequest[],
  messageIds: readonly string[],
  turns: readonly SaidTurn[],
  activity: readonly Pick<ActivityEvent, "at" | "runId" | "type">[],
) {
  const messages = messageIds.map((id) => {
    const turn = turns.find((t) => t.id === id.replace(/:reply$/, ""));
    const at =
      turn &&
      (id.endsWith(":reply")
        ? (saidAt(turn, activity) ?? turn.createdAt)
        : turn.createdAt);
    return { id, at };
  });
  const receipts: Receipt[] = background
    .flatMap((request) =>
      request.asks
        .filter((ask) => ask.status !== "pending")
        .map((ask) => ({
          ask,
          title: request.title,
          at: ask.settledAt ?? ask.createdAt,
        })),
    )
    .sort((a, b) => a.at - b.at);
  const above = new Map<string, Receipt[]>();
  const last = receipts.filter((receipt) => {
    const next = messages.find((m) => (m.at ?? -1) >= receipt.at);
    if (!next) return true;
    above.set(next.id, [...(above.get(next.id) ?? []), receipt]);
    return false;
  });
  return { above, last };
}
