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
import type { WorkItem, WorkStatus } from "@raphie/contracts";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { isPrivateDestination } from "../../channels/domain/binding.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import {
  clip,
  isOpen,
  LIMITS,
  listWork,
  workId,
  workLine,
} from "../domain/work-item.ts";
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

  constructor(app: DurableContext) {
    this.app = app;
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
export function createWorkTools() {
  return defineExtension({
    name: "raphie.work-items",
    sections: [
      section("work-items", () =>
        [
          "You keep work items: your record of each thing you are tracking for the owner for longer than one turn, such as a request you are still chasing, something you promised to come back to, or a decision you are waiting on. Your open items come with each of the owner's messages under [Open work].",
          "Open one with work_open when something will outlive this turn. Never open one for a request you settle in the same reply, and check the open items first so you do not open the same thing twice.",
          "Keep an item current with work_update as it changes: its status (active while you work on it, waiting while it is blocked, with what it waits on), short notes, and its latest result. Close it with work_close, done or dropped, as soon as it is finished or the owner no longer wants it.",
          "When the owner asks what is going on, answer from your work items, not from memory of the chat. Use work_read for one item's notes, and work_list for closed items or more than the message lists.",
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
            const state = await tx.doc(WorkItems);
            const now = Date.now();
            const status: WorkStatus = args.status ?? "active";
            const item: WorkItem = {
              id: workId(state.next),
              title: clip(args.title, LIMITS.title),
              status,
              ...(status === "waiting" && args.waitingOn
                ? { waitingOn: clip(args.waitingOn, LIMITS.waitingOn) }
                : {}),
              ...(chat.turnId ? { sourceTurnId: chat.turnId } : {}),
              notes: clip(args.notes ?? "", LIMITS.notes),
              opened: { at: now, by: "bot" },
              updatedAt: now,
            };
            state.next += 1;
            state.items.push(item);
            record(
              await tx.doc(Activity),
              "work.opened",
              "Opened a work item",
              {
                conversationId: api.conversationId,
                operationId: item.id,
                details: { title: item.title },
              },
            );
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
            const item = find(await tx.doc(WorkItems), args.id);
            if (!item) return { error: `No work item ${args.id}.` };
            if (!isOpen(item.status))
              return {
                error: `${item.id} is closed. Open a new item if the work starts again.`,
              };
            const now = Date.now();
            if (args.title) item.title = clip(args.title, LIMITS.title);
            if (args.status) item.status = args.status;
            if (item.status === "active") delete item.waitingOn;
            else if (args.waitingOn !== undefined)
              item.waitingOn = clip(args.waitingOn, LIMITS.waitingOn);
            if (args.notes !== undefined)
              item.notes = clip(args.notes, LIMITS.notes);
            if (args.result)
              item.result = { text: clip(args.result, LIMITS.result), at: now };
            item.updatedAt = now;
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
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const item = find(await tx.doc(WorkItems), args.id);
            if (!item) return { error: `No work item ${args.id}.` };
            if (!isOpen(item.status))
              return { error: `${item.id} is already ${item.status}.` };
            const now = Date.now();
            item.status = args.outcome;
            delete item.waitingOn;
            if (args.result)
              item.result = { text: clip(args.result, LIMITS.result), at: now };
            item.updatedAt = now;
            item.closed = { at: now, by: "bot" };
            record(
              await tx.doc(Activity),
              "work.closed",
              "Closed a work item",
              {
                conversationId: api.conversationId,
                operationId: item.id,
                details: { title: item.title, outcome: args.outcome },
              },
            );
            return JSON.stringify({ closed: true, item: workLine(item) });
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
