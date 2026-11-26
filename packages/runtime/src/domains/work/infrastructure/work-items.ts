import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable";
import { bool, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { WorkActor, WorkItem, WorkStatus } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { isPrivateDestination } from "../../channels/domain/binding.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import {
  changeWork,
  clip,
  isOpen,
  LIMITS,
  listWork,
  type WorkChange,
  workId,
  workLine,
} from "../domain/work-item.ts";
import type { WorkRuns } from "./work-runs.ts";
import { WorkItems, type WorkState } from "./work-store.ts";

/** A tool call's result, stored with its change so a replay repeats neither. */
const Receipt = defineDoc<{ text: string | null; error?: true }>({
  kind: "raphie.work-mutation",
  version: 1,
  scope: "task",
  checkpointWhen: () => false,
  initial: () => ({ text: null }),
});

export class WorkService {
  app: DurableContext;
  /** The background runs, once the bot has them. */
  runs?: WorkRuns;

  constructor(app: DurableContext) {
    this.app = app;
  }

  /** Stops an item's running background work. */
  async cancel(id: string) {
    if (!this.runs) throw new InputError("Work items have no runs here.", 409);
    await this.runs.cancel(await this.get(id));
  }

  async state(): Promise<Readonly<WorkState>> {
    return (
      (await this.app.harness.snapshot(WorkItems, context)) ?? {
        items: [],
        next: 1,
      }
    );
  }

  /** Open or closed items, newest activity first, optionally matching `query`. */
  async list(filter: { open: boolean; query?: string }) {
    return listWork((await this.state()).items, filter);
  }

  async get(id: string) {
    return (await this.state()).items.find((item) => item.id === id);
  }

  /** The owner opens an item. */
  async open(input: { title: string; notes?: string }) {
    return this.app.root.commit((tx) => openWork(tx, input, "owner"), context);
  }

  /**
   * The owner changes, closes or reopens an item. Closing one stops its
   * running work; the run then keeps its result without telling the chat.
   */
  async change(id: string, change: WorkChange) {
    const item = await this.app.root.commit(
      (tx) => changeWorkItem(tx, id, change, "owner"),
      context,
    );
    if (typeof item !== "string" && !isOpen(item.status) && item.run?.turnId)
      await this.runs?.cancel(item).catch(() => {});
    return item;
  }
}

/** A plain copy of an item read in a transaction, usable after it settles. */
function detached(item: WorkItem): WorkItem {
  return JSON.parse(JSON.stringify(item)) as WorkItem;
}

/** Opens an item as `by` opens it, or says why not. */
async function openWork(
  tx: Tx,
  input: {
    title: string;
    status?: WorkStatus;
    waitingOn?: string;
    notes?: string;
  },
  by: WorkActor,
  from?: { conversationId: number; turnId?: string },
): Promise<WorkItem | string> {
  const sourceTurnId = from?.turnId;
  const title = clip(input.title, LIMITS.title);
  if (!title) return "A work item needs a title.";
  const state = await tx.doc(WorkItems);
  const now = Date.now();
  const status = input.status === "waiting" ? "waiting" : "active";
  const item: WorkItem = {
    id: workId(state.next),
    title,
    status,
    ...(status === "waiting" && input.waitingOn
      ? { waitingOn: clip(input.waitingOn, LIMITS.waitingOn) }
      : {}),
    ...(sourceTurnId ? { sourceTurnId } : {}),
    notes: clip(input.notes ?? "", LIMITS.notes),
    opened: { at: now, by },
    updatedAt: now,
  };
  state.next += 1;
  state.items.push(item);
  record(await tx.doc(Activity), "work.opened", "Opened a work item", {
    ...(from ? { conversationId: from.conversationId } : {}),
    operationId: item.id,
    details: { title: item.title, by },
  });
  return detached(item);
}

/** Changes an item as `by` changes it, or says why not. */
async function changeWorkItem(
  tx: Tx,
  id: string,
  change: WorkChange,
  by: WorkActor,
  conversationId?: number,
): Promise<WorkItem | string> {
  const item = find(await tx.doc(WorkItems), id);
  if (!item) return `No work item ${id}.`;
  const was = item.status;
  const refused = changeWork(item, change, by, Date.now());
  if (refused) return refused;
  if (isOpen(was) !== isOpen(item.status))
    record(
      await tx.doc(Activity),
      isOpen(item.status) ? "work.reopened" : "work.closed",
      isOpen(item.status) ? "Reopened a work item" : "Closed a work item",
      {
        ...(conversationId === undefined ? {} : { conversationId }),
        operationId: item.id,
        details: { title: item.title, status: item.status, by },
      },
    );
  return detached(item);
}

/** Runs one change and stores its result under the tool call. */
async function mutate(
  api: ToolExecutionApi,
  ctx: Context,
  change: (tx: Tx) => Promise<string | { error: string }>,
) {
  const receipt = await api.commit(async (tx) => {
    const stored = await tx.doc(Receipt, api.taskId);
    if (stored.text === null) {
      const result = await change(tx);
      if (typeof result === "string") stored.text = result;
      else {
        stored.text = result.error;
        stored.error = true;
      }
    }
    return { text: stored.text, error: stored.error };
  }, ctx);
  return {
    output: [{ type: "text" as const, text: receipt.text }],
    ...(receipt.error ? { isError: true } : {}),
  };
}

const NOT_IN_CHAT =
  "Work items belong to your chat with the owner. Keep track of this in your reply instead.";

/**
 * Work items are the owner's: only the bot's chat reads and changes them,
 * and only in a turn whose reply stays private, so a group never hears of
 * them (a scheduled run whose home is a group is in the chat but answers the
 * group). Returns the chat turn being answered, if any.
 */
async function chatTurn(tx: Tx, api: ToolExecutionApi) {
  const chats = await tx.doc(Chats);
  const conversation = chats.conversations.find(
    (c) => c.id === api.conversationId,
  );
  if (!conversation?.chat) return undefined;
  const turn = chats.turns.find(
    (t) => t.conversationId === conversation.id && t.status === "pending",
  );
  if (turn?.replyTo && !isPrivateDestination(turn.replyTo)) return undefined;
  return { turnId: turn?.id };
}

function find(state: WorkState, id: string) {
  return state.items.find((item) => item.id === id.trim());
}

const id = str({
  minLength: 1,
  maxLength: 20,
  description: 'The item\'s id, such as "w-12".',
});
const title = str({
  minLength: 1,
  maxLength: 200,
  description: 'A few words naming it, such as "Flights to Lisbon".',
});
const waitingOn = str({
  maxLength: 400,
  description:
    'On whom or what it waits, in a few words, such as "the owner to pick a date".',
});
const notes = str({
  maxLength: 8_000,
  description:
    "Your running notes on it, replacing the earlier ones: what is done, what is next, details to keep.",
});
const result = str({
  maxLength: 8_000,
  description: "Its latest result, as you would tell the owner.",
});

/** The tools and instructions that let a bot keep its work items. */
export function createWorkTools(runs: WorkRuns) {
  return defineExtension({
    name: "raphie.work-items",
    sections: [
      section("work-items", () =>
        [
          "You keep work items: your record of each thing you are tracking for the owner for longer than one turn, such as a request you are still chasing, something you promised to come back to, or a decision you are waiting on. Your open items come with each of the owner's messages under [Open work].",
          "Open one with work_open when something will outlive this turn. Never open one for a request you settle in the same reply, and check the open items first so you do not open the same thing twice.",
          "Keep an item current with work_update as it changes: its status (active while you work on it, waiting while it is blocked, with what it waits on), short notes, and its latest result. Close it with work_close, done or dropped, as soon as it is finished or the owner no longer wants it.",
          "When the owner asks what is going on, answer from your work items, not from memory of the chat. Use work_read for one item's notes, and work_list for closed items or more than the message lists.",
          "For work that takes a while, such as research, comparisons or drafting something long, start it in the background with work_start instead of doing it in this reply: it runs in the item's own session, keeps that context for follow-ups, and its result comes back to this chat as a new message. Tell the owner you are on it; don't wait for it or invent its result. Send a follow-up to the same item with work_start again once its run has ended.",
          "Work items are only for your chat with the owner; never mention them anywhere else.",
        ].join("\n"),
      ),
    ],
    tools: [
      defineTool({
        name: "work_open",
        description:
          "Open a work item for something you will keep track of beyond this turn. Returns its id.",
        parameters: obj({
          title,
          status: opt(oneOf(["active", "waiting"])),
          waitingOn: opt(waitingOn),
          notes: opt(notes),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            const chat = await chatTurn(tx, api);
            if (!chat) return { error: NOT_IN_CHAT };
            const item = await openWork(tx, args, "bot", {
              conversationId: api.conversationId,
              turnId: chat.turnId,
            });
            if (typeof item === "string") return { error: item };
            return JSON.stringify({ opened: true, item: workLine(item) });
          }),
      }),
      defineTool({
        name: "work_update",
        description:
          "Change an open work item: its title, status, what it waits on, your notes or its latest result. Pass only what changes.",
        parameters: obj({
          id,
          title: opt(title),
          status: opt(oneOf(["active", "waiting"])),
          waitingOn: opt(waitingOn),
          notes: opt(notes),
          result: opt(result),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const { id: itemId, ...change } = args;
            const item = await changeWorkItem(
              tx,
              itemId,
              change,
              "bot",
              api.conversationId,
            );
            if (typeof item === "string") return { error: item };
            return JSON.stringify({ updated: true, item: workLine(item) });
          }),
      }),
      defineTool({
        name: "work_close",
        description:
          "Close a work item: done when it is finished, dropped when it is no longer wanted. Give its final result when there is one.",
        parameters: obj({
          id,
          outcome: oneOf(["done", "dropped"]),
          result: opt(result),
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const result = await mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const item = await changeWorkItem(
              tx,
              args.id,
              { status: args.outcome, result: args.result },
              "bot",
              api.conversationId,
            );
            if (typeof item === "string") return { error: item };
            return JSON.stringify({ closed: true, item: workLine(item) });
          });
          // Closing a running item stops its work, as on the Work page.
          const item = (await api.snapshot(WorkItems, ctx))?.items.find(
            (each) => each.id === args.id.trim(),
          );
          if (item && !isOpen(item.status) && item.run?.turnId)
            await runs.cancel(item).catch(() => {});
          return result;
        },
      }),
      defineTool({
        name: "work_start",
        description:
          "Start background work on an open work item: the brief runs in the item's own session, and its result returns to this chat as a new message. Returns at once. One run at a time per item.",
        parameters: obj({
          id,
          brief: str({
            minLength: 1,
            maxLength: 8_000,
            description:
              "Everything the background run needs, since it can't see this chat: the goal, what you know, constraints and what to return.",
          }),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const item = await runs.start(tx, args.id, args.brief);
            if (typeof item === "string") return { error: item };
            return JSON.stringify({ started: true, item: workLine(item) });
          }),
      }),
      defineTool({
        name: "work_read",
        description:
          "Read one work item in full, open or closed: its notes and latest result.",
        parameters: obj({ id }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const item = find(await tx.doc(WorkItems), args.id);
            if (!item) return { error: `No work item ${args.id}.` };
            return JSON.stringify(item);
          }),
      }),
      defineTool({
        name: "work_list",
        description:
          "List work items, one line each, newest activity first: open ones, or closed ones with closed: true. query keeps those whose id, title, notes or result contain it.",
        parameters: obj({
          closed: opt(bool()),
          query: opt(str({ maxLength: 200 })),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const items = listWork((await tx.doc(WorkItems)).items, {
              open: !args.closed,
              query: args.query,
            }).slice(0, 50);
            return items.length
              ? items.map(workLine).join("\n")
              : `No ${args.closed ? "closed" : "open"} work items${args.query ? ` matching "${args.query}"` : ""}.`;
          }),
      }),
    ],
  });
}
