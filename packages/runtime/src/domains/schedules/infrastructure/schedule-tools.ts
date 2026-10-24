import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

import {
  ToolApprovals,
  type ToolApprovalService,
} from "../../approvals/infrastructure/pi-tool-approvals.ts";
import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { BotJobs } from "./bot-jobs.ts";

/** Bot and destination come from the active tool context, never model arguments. */
export function createScheduleTools(
  jobs: BotJobs,
  approvals: ToolApprovalService,
) {
  return defineExtension({
    name: "raphie.scheduling",
    tools: [
      defineTool({
        name: "schedule_create",
        description:
          "Schedule a prompt in this conversation after a delay. Use for reminders, timers, and recurring work requested by the owner. Omit everyMinutes for a one-time reminder. Requires approval of the exact prompt and time. The runtime must be running; delivery is a conversation reply, not a device push notification. Only confirm success after this tool returns saved:true.",
        parameters: Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 80 }),
            prompt: Type.String({
              minLength: 1,
              maxLength: 4000,
              description:
                "Instructions for the future reply, including requested reminder content and tone.",
            }),
            delaySeconds: Type.Integer({
              minimum: 1,
              maximum: 31536000,
              description:
                "Seconds from now until the first run. Two minutes is 120.",
            }),
            everyMinutes: Type.Optional(
              Type.Integer({
                minimum: 1,
                maximum: 525600,
                description:
                  "Repeat interval in minutes. Omit for a one-time reminder.",
              }),
            ),
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
          const argumentsJson = JSON.stringify(
            {
              ...input,
              firstRunAt: new Date(firstRunAt).toISOString(),
              destination: "This conversation",
            },
            null,
            2,
          );
          const fingerprint = new Bun.CryptoHasher("sha256")
            .update(argumentsJson)
            .digest("hex");
          const proposal = await approvals.ensure(api, ctx, {
            server: "Raphie schedules",
            tool: "schedule_create",
            argumentsJson,
            fingerprint,
          });
          const decision = await approvals.wait(api, ctx, proposal);
          if (decision.status !== "approved")
            return {
              output: [
                {
                  type: "text",
                  text: `Schedule ${decision.status}. No job was saved.`,
                },
              ],
              isError: true,
            };
          const result = await api.commit(async (tx) => {
            const approval = (await tx.doc(ToolApprovals)).approvals.find(
              (item) => item.id === proposal.id,
            )!;
            if (approval.execution === "done") return approval.result!;
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
            const saved = {
              text: JSON.stringify({
                saved: true,
                id: job.id,
                name: job.name,
                firstRunAt: new Date(job.firstRunAt).toISOString(),
                everyMinutes: job.everyMinutes,
                destination: "This conversation",
              }),
              isError: false,
            };
            approval.execution = "done";
            approval.result = saved;
            return saved;
          }, ctx);
          return {
            output: [{ type: "text", text: result.text }],
            isError: result.isError,
          };
        },
      }),
      defineTool({
        name: "schedule_list",
        description:
          "List this bot's scheduled prompts and reminders, including their IDs, timing and enabled state. Does not change schedules.",
        parameters: Type.Object({}, { additionalProperties: false }),
        replay: "safe",
        execute: async () => ({
          output: [{ type: "text", text: JSON.stringify(await jobs.read()) }],
        }),
      }),
    ],
  });
}
