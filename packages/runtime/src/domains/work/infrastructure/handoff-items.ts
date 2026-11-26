import type { Tx } from "@earendil-works/pi-durable";
import type { Handoff, TurnHandoff, WorkItem } from "@raphie/contracts";

import { clip, isOpen, LIMITS, workId } from "../domain/work-item.ts";
import { WorkItems, type WorkState } from "./work-store.ts";

/** The sending bot's item for a handoff, if it keeps one. */
export function sentItem(state: WorkState | undefined, handoffId: string) {
  return state && itemOf(state, "handoff-sent", handoffId);
}

type Side = "handoff-sent" | "handoff-received";

function itemOf(state: WorkState, side: Side, handoffId: string) {
  return state.items.find(
    (i) => i.origin?.kind === side && i.origin.handoffId === handoffId,
  );
}

function openItem(
  state: WorkState,
  input: {
    side: Side;
    handoffId: string;
    bot: { id: string; name: string };
    title: string;
    notes: string;
  },
  now: number,
) {
  const item: WorkItem = {
    id: workId(state.next),
    title: clip(input.title, LIMITS.title) || "Handed-off task",
    status: "active",
    origin: { kind: input.side, handoffId: input.handoffId, bot: input.bot },
    notes: clip(input.notes, LIMITS.notes),
    opened: { at: now, by: "bot" },
    updatedAt: now,
  };
  state.next += 1;
  state.items.push(item);
  // The document keeps its own copy: later changes go to that one.
  return state.items.at(-1)!;
}

/** Reopens a closed item when its handoff starts working again. */
function reopen(item: WorkItem) {
  if (isOpen(item.status)) return;
  item.status = "active";
  delete item.closed;
}

/**
 * Keeps the sending bot's item for `handoff` in step with its record, in the
 * caller's transaction: waiting on the other bot while a request is out, with
 * each result as it returns. `open` makes the item when there is none yet;
 * otherwise a handoff without one is left alone. `started` says a request
 * was just sent, which reopens a closed item; other changes leave it closed.
 * `finished` is a request whose result is being reported: it counts as done.
 * Returns whether the item is open, or undefined when there is none.
 */
export async function syncSentHandoff(
  tx: Tx,
  handoff: Handoff,
  options: {
    open?: boolean;
    started?: boolean;
    finished?: number;
    result?: string;
  } = {},
): Promise<boolean | undefined> {
  const state = await tx.doc(WorkItems);
  const now = Date.now();
  let item = itemOf(state, "handoff-sent", handoff.id);
  if (!item) {
    if (!options.open) return undefined;
    item = openItem(
      state,
      {
        side: "handoff-sent",
        handoffId: handoff.id,
        bot: handoff.to,
        title: handoff.title,
        notes: handoff.requests[0]?.brief ?? "",
      },
      now,
    );
  }
  const n = handoff.requests.findLastIndex(
    (r, i) => r.outcome === null && i !== options.finished,
  );
  const runPrefix = `handoff:${handoff.id}:`;
  if (options.started) reopen(item);
  if (n >= 0 && isOpen(item.status)) {
    const request = handoff.requests[n]!;
    const id = `${runPrefix}${n}`;
    if (item.run?.id !== id) item.run = { id, startedAt: request.sentAt };
    if (request.turnId) item.run.turnId = request.turnId;
    item.status = "waiting";
    item.waitingOn = `${handoff.to.name} to finish`;
  } else {
    if (item.run?.id?.startsWith(runPrefix)) delete item.run;
    if (item.status === "waiting") {
      item.status = "active";
      delete item.waitingOn;
    }
  }
  if (options.result !== undefined)
    item.result = { text: clip(options.result, LIMITS.result), at: now };
  item.updatedAt = now;
  return isOpen(item.status);
}

/**
 * The receiving bot's item for a task another bot handed it, in the caller's
 * transaction: opened (or reopened) and running while the task's turn runs
 * in its session.
 */
export async function receiveHandoff(
  tx: Tx,
  input: {
    handoff: TurnHandoff;
    brief: string;
    sessionId: string;
    turnId: string;
  },
) {
  const state = await tx.doc(WorkItems);
  const now = Date.now();
  const item =
    itemOf(state, "handoff-received", input.handoff.id) ??
    openItem(
      state,
      {
        side: "handoff-received",
        handoffId: input.handoff.id,
        bot: input.handoff.bot,
        title: input.handoff.title,
        notes: input.brief,
      },
      now,
    );
  reopen(item);
  item.status = "active";
  delete item.waitingOn;
  item.sessionId = input.sessionId;
  item.run = {
    id: `handoff:${input.turnId}`,
    startedAt: now,
    turnId: input.turnId,
  };
  item.updatedAt = now;
}

/**
 * A received task's turn ended: its answer becomes the item's result, and the
 * item closes until the bot that handed it follows up.
 */
export async function settleReceivedHandoff(
  tx: Tx,
  input: {
    handoffId: string;
    turnId: string;
    result: string;
    cancelled?: boolean;
  },
) {
  const state = await tx.doc(WorkItems);
  const item = itemOf(state, "handoff-received", input.handoffId);
  if (!item) return;
  const now = Date.now();
  if (item.run?.turnId === input.turnId) delete item.run;
  item.result = {
    text: clip(input.result, LIMITS.result),
    at: now,
    turnId: input.turnId,
  };
  if (isOpen(item.status) && !item.run) {
    item.status = input.cancelled ? "dropped" : "done";
    delete item.waitingOn;
    item.closed = { at: now, by: "bot" };
  }
  item.updatedAt = now;
}
