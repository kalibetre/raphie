import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type TaskId,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable";
import {
  bool,
  nullable,
  obj,
  oneOf,
  opt,
  str,
} from "@earendil-works/pi-schema";
import type { WorkActor, WorkItem } from "@raphie/contracts";
import { z } from "zod";

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
  reminderIssue,
  type WorkChange,
  workId,
  workLine,
  workListText,
} from "../domain/work-item.ts";
import {
  cancelReminder,
  clearReminder,
  createWorkReminderTask,
} from "./work-reminders.ts";
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

type OpenWork = {
  title: string;
  status?: "active" | "waiting" | "deferred";
  waitingOn?: string;
  notes?: string;
  reminderAt?: number;
};

export class WorkService {
  app: DurableContext;
  /** The background runs, once the bot has them. */
  runs?: WorkRuns;

  private reminder: ReturnType<typeof createWorkReminderTask>;

  constructor(
    app: DurableContext,
    post: Parameters<typeof createWorkReminderTask>[0],
  ) {
    this.app = app;
    this.reminder = createWorkReminderTask(post);
  }

  reminderExtension() {
    return defineExtension({
      name: "raphie.work-reminders",
      tasks: [this.reminder],
    });
  }

  /** The scheduler reports faults after it has committed the task's outcome. */
  async clearFaultedReminder(taskId: TaskId) {
    await this.app.root.commit(async (tx) => {
      const state = await tx.doc(WorkItems);
      const owner = Object.entries(state.reminderTasks ?? {}).find(
        ([, timer]) => timer === taskId,
      );
      if (owner) clearReminder(state, owner[0], taskId, Date.now());
    }, context);
  }

  /** Recover if the process stopped after a task ended but before cleanup. */
  async recoverReminders() {
    if (!Object.keys((await this.state()).reminderTasks ?? {}).length) return;
    await this.app.root.commit(async (tx) => {
      const state = await tx.doc(WorkItems);
      for (const [id, taskId] of Object.entries(state.reminderTasks ?? {})) {
        const task = await tx.task(taskId);
        if (!task || task.state.status === "terminal")
          clearReminder(state, id, taskId, Date.now());
      }
    }, context);
  }

  private async scheduleReminder(tx: Tx, id: string, at: number) {
    const state = await tx.doc(WorkItems);
    state.reminderTasks ??= {};
    state.reminderTasks[id] = await tx.createTask(
      this.reminder,
      { id, at },
      {
        conversationId: this.app.root.id,
        ownership: { kind: "conversation" },
        background: true,
      },
    );
  }

  async openIn(
    tx: Tx,
    input: OpenWork,
    by: WorkActor,
    from?: { conversationId: number; turnId?: string },
  ) {
    const item = await openWork(tx, input, by, from);
    if (typeof item !== "string" && item.reminderAt !== undefined)
      await this.scheduleReminder(tx, item.id, item.reminderAt);
    return item;
  }

  async changeIn(
    tx: Tx,
    id: string,
    input: WorkChange,
    by: WorkActor,
    conversationId?: number,
  ) {
    const state = await tx.doc(WorkItems);
    const previous = find(state, id)?.reminderAt;
    const item = await changeWorkItem(tx, id, input, by, conversationId);
    if (typeof item === "string") return item;
    const taskId = state.reminderTasks?.[item.id];
    if (item.reminderAt !== previous) {
      if (taskId !== undefined) {
        await cancelReminder(tx, taskId);
        delete state.reminderTasks?.[item.id];
      }
      if (item.reminderAt !== undefined)
        await this.scheduleReminder(tx, item.id, item.reminderAt);
    } else if (
      item.reminderAt !== undefined &&
      input.reminderAt === item.reminderAt
    ) {
      // An explicit retry can arrive after the fault but before its cleanup.
      const task = taskId === undefined ? undefined : await tx.task(taskId);
      if (!task || task.state.status === "terminal")
        await this.scheduleReminder(tx, item.id, item.reminderAt);
    }
    return item;
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

  /** Open items in `byAttention` order, or closed ones newest first, optionally matching `query`. */
  async list(filter: { open: boolean; query?: string }) {
    return listWork((await this.state()).items, filter);
  }

  async get(id: string) {
    return (await this.state()).items.find((item) => item.id === id);
  }

  /** The owner opens an item. */
  async open(input: OpenWork) {
    const item = await this.app.root.commit(
      (tx) => this.openIn(tx, input, "owner"),
      context,
    );
    if (typeof item !== "string" && item.reminderAt !== undefined)
      this.app.harness.resume();
    return item;
  }

  /**
   * The owner changes, closes or reopens an item. Closing one stops its
   * running work; the run then keeps its result without telling the chat.
   */
  async change(id: string, change: WorkChange) {
    const item = await this.app.root.commit(
      (tx) => this.changeIn(tx, id, change, "owner"),
      context,
    );
    if (typeof item !== "string" && !isOpen(item.status) && item.run?.turnId)
      await this.runs?.cancel(item).catch(() => {});
    if (typeof item !== "string" && typeof change.reminderAt === "number")
      this.app.harness.resume();
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
  input: OpenWork,
  by: WorkActor,
  from?: { conversationId: number; turnId?: string },
): Promise<WorkItem | string> {
  const sourceTurnId = from?.turnId;
  const title = clip(input.title, LIMITS.title);
  if (!title) return "A work item needs a title.";
  const now = Date.now();
  if (input.reminderAt !== undefined) {
    const issue = reminderIssue(input.reminderAt, now);
    if (issue) return issue;
  }
  const state = await tx.doc(WorkItems);
  const status = input.status ?? "active";
  const item: WorkItem = {
    id: workId(state.next),
    title,
    status,
    ...(status === "waiting" && input.waitingOn
      ? { waitingOn: clip(input.waitingOn, LIMITS.waitingOn) }
      : {}),
    ...(sourceTurnId ? { sourceTurnId } : {}),
    ...(input.reminderAt === undefined ? {} : { reminderAt: input.reminderAt }),
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

/**
 * Keeps a scheduled job's work item in step with the job, in the caller's
 * transaction: opened with the job, named after it, waiting while it is
 * paused, and done once it is removed or a one-time job has run. `job` is
 * undefined once removed.
 */
export async function syncJobItem(
  tx: Tx,
  jobId: string,
  job:
    | {
        name: string;
        prompt: string;
        enabled: boolean;
        nextRunAt: number;
        everyMinutes: number | null;
        lastRunAt: number | null;
      }
    | undefined,
  by: WorkActor,
) {
  const state = await tx.doc(WorkItems);
  let item = state.items.find(
    (i) => i.origin?.kind === "job" && i.origin.jobId === jobId,
  );
  const now = Date.now();
  if (!item) {
    if (!job) return;
    item = {
      id: workId(state.next),
      title: clip(job.name, LIMITS.title),
      status: "active",
      origin: { kind: "job", jobId },
      notes: clip(job.prompt, LIMITS.notes),
      opened: { at: now, by },
      updatedAt: now,
    };
    state.next += 1;
    state.items.push(item);
    // The document keeps its own copy: later changes go to that one.
    item = state.items.at(-1)!;
  }
  const finished =
    !job || (!job.enabled && job.everyMinutes === null && !!job.lastRunAt);
  if (finished) {
    if (isOpen(item.status)) {
      item.status = "done";
      delete item.waitingOn;
      delete item.nextAt;
      item.closed = { at: now, by };
      item.updatedAt = now;
    }
    return;
  }
  item.title = clip(job.name, LIMITS.title);
  item.notes = clip(job.prompt, LIMITS.notes);
  if (job.enabled) {
    item.status = "active";
    delete item.waitingOn;
    item.nextAt = job.nextRunAt;
  } else {
    item.status = "waiting";
    item.waitingOn = "the owner to resume the job";
    delete item.nextAt;
  }
  delete item.closed;
  item.updatedAt = now;
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
 * them (a job run with no item yet is in the chat but may answer a group
 * home). Returns the chat turn being answered, if any.
 */
async function chatTurn(tx: Tx, api: ToolExecutionApi) {
  const chats = await tx.doc(Chats);
  const conversation = chats.conversations.find(
    (c) => c.id === api.conversationId,
  );
  if (!conversation?.chat) return undefined;
  const pending = chats.turns.filter(
    (t) => t.conversationId === conversation.id && t.status === "pending",
  );
  // A call can't tell which pending turn it serves: refuse if any may reply
  // where others read it.
  if (pending.some((t) => t.replyTo && !isPrivateDestination(t.replyTo)))
    return undefined;
  return { turnId: pending[0]?.id };
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
const reminderAt = str({
  maxLength: 40,
  description:
    "A future ISO 8601 date and time with UTC offset (YYYY-MM-DDTHH:MM:SS+03:00). Use the owner's time zone.",
});
const reminderDate = z.iso.datetime({ offset: true });

function parseReminder(value: string): number {
  return reminderDate.safeParse(value).success ? Date.parse(value) : NaN;
}

/** The tools and instructions that let a bot keep its work items. */
export function createWorkTools(work: WorkService, runs: WorkRuns) {
  return defineExtension({
    name: "raphie.work-items",
    sections: [
      section("work-items", () =>
        [
          "You keep work items: your record of each thing you are tracking for the owner for longer than one turn, such as a request you are still chasing, something you promised to come back to, or a decision you are waiting on. Your open items come with each of the owner's messages under [Open work].",
          "Open one with work_open when something will outlive this turn. Never open one for a request you settle in the same reply, and check the open items first so you do not open the same thing twice.",
          "When the owner asks you to save something for later, open or update it with status deferred and keep its context in the notes. Leave it deferred until the owner asks you to start. Use work_list with deferred: true when asked what is parked or in the backlog. To start again, set it active before doing the work.",
          "When the owner asks to be reminded about a work item, set reminderAt on that item with work_open or work_update. If it does not exist and they want to do the work later, open it deferred. Do not create a scheduled job for this. If the time is unclear, ask when. Confirm the exact time after the tool succeeds. Snooze by replacing reminderAt and remove a reminder by passing null to work_update. A reminder posts to this chat without starting work.",
          "Keep an item current with work_update as it changes: active while you work on it, waiting while it is blocked, and deferred while deliberately parked. Close it with work_close, done or dropped, as soon as it is finished or the owner no longer wants it.",
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
          status: opt(oneOf(["active", "waiting", "deferred"])),
          waitingOn: opt(waitingOn),
          notes: opt(notes),
          reminderAt: opt(reminderAt),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            const chat = await chatTurn(tx, api);
            if (!chat) return { error: NOT_IN_CHAT };
            const { reminderAt: at, ...input } = args;
            const item = await work.openIn(
              tx,
              {
                ...input,
                reminderAt: at === undefined ? undefined : parseReminder(at),
              },
              "bot",
              {
                conversationId: api.conversationId,
                turnId: chat.turnId,
              },
            );
            if (typeof item === "string") return { error: item };
            return JSON.stringify({ opened: true, item: workLine(item) });
          }),
      }),
      defineTool({
        name: "work_update",
        description:
          "Change an open work item's title, status, what it waits on, notes, result or reminder time. Pass null to remove a reminder and omit unchanged fields.",
        parameters: obj({
          id,
          title: opt(title),
          status: opt(oneOf(["active", "waiting", "deferred"])),
          waitingOn: opt(waitingOn),
          notes: opt(notes),
          result: opt(result),
          reminderAt: opt(nullable(reminderAt)),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            const { id: itemId, reminderAt: at, ...change } = args;
            const item = await work.changeIn(
              tx,
              itemId,
              {
                ...change,
                reminderAt: typeof at === "string" ? parseReminder(at) : at,
              },
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
            const item = await work.changeIn(
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
          "List work items, one line each. Set deferred: true for the backlog, or closed: true for closed items. query keeps those whose id, title, notes or result contain it.",
        parameters: obj({
          closed: opt(bool()),
          deferred: opt(bool()),
          query: opt(str({ maxLength: 200 })),
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx) => {
            if (!(await chatTurn(tx, api))) return { error: NOT_IN_CHAT };
            return workListText((await tx.doc(WorkItems)).items, {
              closed: !!args.closed && !args.deferred,
              deferred: args.deferred,
              query: args.query,
            });
          }),
      }),
    ],
  });
}
