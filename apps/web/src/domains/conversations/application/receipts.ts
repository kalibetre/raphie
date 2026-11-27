import type { BackgroundRequest, SessionAsk } from "@raphie/contracts";

/** A receipt of a background question the owner answered, or that lapsed. */
export type Receipt = { ask: SessionAsk; title: string; at: number };

/**
 * Where each receipt of the background work's settled questions goes in
 * the conversation: above the first message said at or after it was
 * settled, by message id, and the rest after the last message.
 */
export function placeReceipts(
  background: readonly BackgroundRequest[],
  messages: readonly { id: string; at?: number }[],
) {
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
