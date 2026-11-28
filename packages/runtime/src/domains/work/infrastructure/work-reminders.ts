import {
  defineSignal,
  defineTask,
  type TaskId,
  type Tx,
} from "@earendil-works/pi-durable";
import { bool } from "@earendil-works/pi-schema";
import type { TurnWork } from "@raphie/contracts";

import { isOpen } from "../domain/work-item.ts";
import { WorkItems, type WorkState } from "./work-store.ts";

type Post = (
  key: string,
  prepare: (tx: Tx) => Promise<{ work: TurnWork; text: string } | undefined>,
) => Promise<unknown>;

const finish = {
  status: "terminal",
  outcome: { status: "completed", result: null },
} as const;

const reminderCancelled = defineSignal({
  name: "raphie.work-reminder-cancelled",
  version: 1,
  schema: bool(),
});

export async function cancelReminder(tx: Tx, taskId: TaskId) {
  await tx.signal(taskId, reminderCancelled, "cancel", true);
}

function due(
  state: Readonly<WorkState> | undefined,
  id: string,
  at: number,
  taskId: TaskId,
) {
  if (state?.reminderTasks?.[id] !== taskId) return undefined;
  return state.items.find(
    (item) => item.id === id && item.reminderAt === at && isOpen(item.status),
  );
}

/** Uses the same durable timer as scheduled jobs and posts without a model turn. */
export function createWorkReminderTask(post: Post) {
  return defineTask<
    { id: string; at: number },
    { phase: "wait" } | { phase: "post" },
    null
  >({
    name: "raphie.work-reminder",
    version: 1,
    initial: () => ({ phase: "wait" }),
    abort: (_, runtime, ctx) =>
      runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        ctx,
      ),
    phases: {
      wait: (task, runtime, ctx) =>
        runtime.commit(
          () => ({
            status: "sleeping",
            until: task.input.at,
            signals: [reminderCancelled.key("cancel")],
            checkpoint: { phase: "post" },
          }),
          ctx,
        ),
      post: async (task, runtime, ctx) => {
        const { id, at } = task.input;
        if (due(await runtime.snapshot(WorkItems, ctx), id, at, task.id)) {
          try {
            await post(`reminder:${task.id}`, async (tx) => {
              // Recheck after entering the chat commit. A snooze, removal or
              // close may have happened since the timer woke.
              const state = await tx.doc(WorkItems);
              const item = due(state, id, at, task.id);
              if (!item) return undefined;
              delete state.reminderTasks?.[id];
              delete item.reminderAt;
              item.updatedAt = runtime.now();
              const title = item.title.replace(/\s+/g, " ");
              return {
                work: { itemId: id, title, kind: "reminder" },
                // Titles are data even when the chat renders the answer as Markdown.
                text: `Reminder: ${title.replace(/[\\[\]<>]/g, "\\$&")}`,
              };
            });
          } catch (error) {
            runtime.report(error);
            await runtime.sleepUntil(
              runtime.now() + 60_000,
              { phase: "post" },
              ctx,
            );
            return;
          }
        }
        await runtime.commit(() => finish, ctx);
      },
    },
  });
}
