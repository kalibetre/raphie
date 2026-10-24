import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type TaskId,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable";
import type { SaveScheduledJob } from "@raphie/contracts";

import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { BotJobs } from "./bot-jobs.ts";

type MutationResult = { text: string; retiredTaskId: TaskId | null };

const Receipt = defineDoc<{ result: MutationResult | null }>({
  kind: "raphie.schedule-mutation",
  version: 1,
  scope: "task",
  checkpointWhen: () => false,
  initial: () => ({ result: null }),
});

/** Persist the result with the mutation, so recovery cannot recreate or repeat an edit. */
async function mutate(
  jobs: BotJobs,
  api: ToolExecutionApi,
  ctx: Context,
  change: (tx: Tx) => Promise<MutationResult>,
) {
  const result = await api.commit(async (tx) => {
    const receipt = await tx.doc(Receipt, api.taskId);
    if (receipt.result) return { ...receipt.result };
    receipt.result = await change(tx);
    // Draft overlays expire when the transaction settles. Return detached values.
    return { ...receipt.result };
  }, ctx);
  if (result.retiredTaskId !== null) await jobs.retire(result.retiredTaskId);
  return { output: [{ type: "text" as const, text: result.text }] };
}

const name = Type.String({ minLength: 1, maxLength: 80 });
const prompt = Type.String({
  minLength: 1,
  maxLength: 4000,
  description:
    "Instructions for the future reply, including requested reminder content and tone.",
});
const delaySeconds = Type.Integer({
  minimum: 1,
  maximum: 31536000,
  description: "Seconds from now until the next run. Two minutes is 120.",
});
const everyMinutes = Type.Integer({
  minimum: 1,
  maximum: 525600,
  description: "Repeat interval in minutes.",
});
const id = Type.String({
  minLength: 1,
  maxLength: 100,
  description:
    "The schedule ID returned by schedule_list or schedule_create. Only this bot's schedules are accessible.",
});

/** Bot and destination come from the active tool context, never model arguments. */
export function createScheduleTools(jobs: BotJobs) {
  return defineExtension({
    name: "raphie.scheduling",
    sections: [
      section("scheduling", ({ agent }) => {
        const names = agent.tools
          .map((tool) => tool.name)
          .filter((name) => name.startsWith("schedule_"));
        if (!names.length) return;
        return [
          `Scheduling is enabled. Your available scheduling tools on this turn are: ${names.join(", ")}. These current capabilities supersede earlier assistant claims that a tool is missing.`,
          "Manage this bot's schedules directly on the owner's request, without approval or another confirmation. Delivery is a reply in the originating conversation while the runtime is running, not a device push notification. External actions performed by a job still require approval.",
          names.includes("schedule_list") &&
            "Use schedule_list to identify the owner's existing reminder before editing or deleting it.",
          names.includes("schedule_update") &&
            'Use schedule_update to edit an existing reminder IN PLACE. Never delete and recreate a reminder to change its topic, wording, name or timing. For example, "I changed my mind, make it about Pi Durable" means update the existing ID with its prompt, and its name too when the name describes the old topic. Preserve its due time, repeat interval and enabled state: omit delaySeconds, everyMinutes and enabled unless the owner explicitly changes them. Confirm the edit only after updated:true.',
          names.includes("schedule_create") &&
            "Use schedule_create only for a new reminder, not an edit. Omit everyMinutes for a one-time reminder. Confirm creation only after saved:true.",
          names.includes("schedule_delete") &&
            "Use schedule_delete only when the owner asks to remove or cancel a reminder, including a completed or disabled one. Confirm deletion only after deleted:true.",
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ],
    tools: [
      defineTool({
        name: "schedule_create",
        description:
          "Create a NEW reminder or recurring prompt in this conversation directly on the owner's request, without approval or confirmation. To edit an existing reminder, use schedule_update instead; do not delete and recreate it. Omit everyMinutes for a one-time reminder. The runtime must be running; delivery is a conversation reply, not a device push notification. Only confirm success after saved:true. External actions performed by the job still require approval.",
        parameters: Type.Object(
          {
            name,
            prompt,
            delaySeconds,
            everyMinutes: Type.Optional(everyMinutes),
          },
          { additionalProperties: false },
        ),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const firstRunAt = await api.memo(
            "first-run-at",
            api.now() + args.delaySeconds * 1000,
            ctx,
          );
          const input = {
            name: args.name.trim(),
            prompt: args.prompt.trim(),
            everyMinutes: args.everyMinutes ?? null,
            firstRunAt,
          };
          if (!input.name || !input.prompt)
            throw new Error("A schedule needs a name and prompt.");
          return mutate(jobs, api, ctx, async (tx) => {
            const session = (await tx.doc(Chats)).conversations.find(
              (item) => item.id === api.conversationId,
            );
            if (!session)
              throw new Error("The schedule's conversation is unavailable.");
            const job = await jobs.schedule(
              tx,
              input,
              `schedule:${api.taskId}`,
              session.sessionId,
            );
            return {
              retiredTaskId: null,
              text: JSON.stringify({
                saved: true,
                id: job.id,
                name: job.name,
                firstRunAt: new Date(job.firstRunAt).toISOString(),
                everyMinutes: job.everyMinutes,
                destination: "This conversation",
              }),
            };
          });
        },
      }),
      defineTool({
        name: "schedule_update",
        description:
          "Update an existing reminder IN PLACE, keeping its ID. Use this when the owner changes their mind about its topic, wording, name or timing; never delete and recreate it. No approval or confirmation is needed. List schedules first to identify the right ID. Supply only changed fields. A topic or wording change needs only id and prompt; omit delaySeconds to keep the original due time. delaySeconds resets the next run relative to now and re-enables the job unless enabled:false. everyMinutes:null makes it one-time. enabled:false pauses it. This does not cancel an already submitted reply or approve external actions.",
        parameters: Type.Object(
          {
            id,
            name: Type.Optional(name),
            prompt: Type.Optional(prompt),
            delaySeconds: Type.Optional(delaySeconds),
            everyMinutes: Type.Optional(
              Type.Union([everyMinutes, Type.Null()]),
            ),
            enabled: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false, minProperties: 2 },
        ),
        replay: "safe",
        execute: async (args, api, ctx) => {
          const patch: Partial<SaveScheduledJob> & { enabled?: boolean } = {};
          if (args.name !== undefined) {
            patch.name = args.name.trim();
            if (!patch.name)
              throw new Error("The schedule name cannot be empty.");
          }
          if (args.prompt !== undefined) {
            patch.prompt = args.prompt.trim();
            if (!patch.prompt)
              throw new Error("The schedule prompt cannot be empty.");
          }
          if (args.everyMinutes !== undefined)
            patch.everyMinutes = args.everyMinutes;
          if (args.enabled !== undefined) patch.enabled = args.enabled;
          if (args.delaySeconds !== undefined)
            patch.firstRunAt = await api.memo(
              "next-run-at",
              api.now() + args.delaySeconds * 1000,
              ctx,
            );
          return mutate(jobs, api, ctx, async (tx) => {
            const { job, retiredTaskId } = await jobs.update(
              tx,
              args.id,
              patch,
            );
            return {
              retiredTaskId,
              text: JSON.stringify({
                updated: true,
                id: job.id,
                name: job.name,
                prompt: job.prompt,
                everyMinutes: job.everyMinutes,
                enabled: job.enabled,
                nextRunAt: new Date(job.nextRunAt).toISOString(),
              }),
            };
          });
        },
      }),
      defineTool({
        name: "schedule_delete",
        description:
          "Remove or cancel this bot's schedule directly when the owner asks, without approval or confirmation. Do not use this to edit a reminder or change its topic; use schedule_update for that. List schedules first to identify the right ID. Stops future scheduled prompts; keeps the conversation and does not cancel a reply already submitted.",
        parameters: Type.Object({ id }, { additionalProperties: false }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(jobs, api, ctx, async (tx) => ({
            retiredTaskId: await jobs.remove(tx, args.id),
            text: JSON.stringify({ deleted: true, id: args.id }),
          })),
      }),
      defineTool({
        name: "schedule_list",
        description:
          "List this bot's scheduled prompts and reminders, including IDs, timing and enabled state. Use before modifying or deleting a schedule. Does not change schedules.",
        parameters: Type.Object({}, { additionalProperties: false }),
        replay: "safe",
        outputLimits: { maxBytes: 64000, maxLines: 1000 },
        execute: async () => ({
          output: [{ type: "text", text: JSON.stringify(await jobs.read()) }],
        }),
      }),
    ],
  });
}
