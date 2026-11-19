import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  defineExtension,
  defineTool,
  section,
  type ToolExecutionApi,
  type Tx,
} from "@earendil-works/pi-durable";
import { obj, str } from "@earendil-works/pi-schema";
import type { Handoff } from "@raphie/contracts";

import { Chats } from "../../conversations/infrastructure/pi-conversation-service.ts";
import type { BotHandoffs } from "./bot-handoffs.ts";

const Receipt = defineDoc<{ text: string | null }>({
  kind: "raphie.handoff-mutation",
  version: 1,
  scope: "task",
  checkpointWhen: () => false,
  initial: () => ({ text: null }),
});

/** Persist the answer with the change, so recovery never hands a task off twice. */
async function mutate(
  api: ToolExecutionApi,
  ctx: Context,
  change: (tx: Tx, sessionId: string, turnId: string | null) => Promise<string>,
) {
  const text = await api.commit(async (tx) => {
    const receipt = await tx.doc(Receipt, api.taskId);
    if (receipt.text !== null) return receipt.text;
    const chats = await tx.doc(Chats);
    const session = chats.conversations.find(
      (item) => item.id === api.conversationId,
    );
    if (!session) throw new Error("This conversation is unavailable.");
    // A handed-off task is done here; it is never handed on again.
    if (session.handedOffBy)
      throw new Error(
        `This task came from ${session.handedOffBy.name}. Do it yourself rather than handing it on.`,
      );
    // The tool runs inside the session's one unqueued pending turn.
    const turn = chats.turns.findLast(
      (item) =>
        item.conversationId === session.id &&
        item.status === "pending" &&
        !item.queueMode,
    );
    receipt.text = await change(tx, session.sessionId, turn?.id ?? null);
    return receipt.text;
  }, ctx);
  return { output: [{ type: "text" as const, text }] };
}

const view = (handoff: Handoff) =>
  JSON.stringify({
    id: handoff.id,
    bot: handoff.to.name,
    title: handoff.title,
    status: handoff.status,
  });

const brief = str({
  minLength: 1,
  maxLength: 4000,
  description:
    "Everything the other bot needs, since it cannot see this conversation: the goal, the context, constraints and what to return.",
});

/** The sending bot comes from the runtime, the target from its allow list; never from model arguments alone. */
export function createHandoffTools(handoffs: BotHandoffs) {
  return defineExtension({
    name: "raphie.handoff-tools",
    sections: [
      section("handoffs", () => {
        const targets = handoffs.targets();
        if (!targets.length) return;
        return [
          `You can hand tasks to these other bots of the owner's: ${targets.map((peer) => peer.name).join(", ")}. Hand a task off when the owner asks, or when it clearly suits one of them better.`,
          "Each handoff runs in the other bot's own session. Its result comes back into this conversation later as a new message, and you then tell the owner what came back. Do not wait for it, poll for it or invent its result.",
          "Use handoff_follow_up to send more instructions on a task you already handed off, so the other bot keeps its context. Use handoff_list to see their status.",
        ].join("\n");
      }),
    ],
    tools: [
      defineTool({
        name: "handoff_create",
        description:
          "Hand a task to another of the owner's bots. It works on it in its own session and its result returns to this conversation as a new message. Returns at once with the handoff's ID.",
        parameters: obj({
          bot: str({
            minLength: 1,
            maxLength: 80,
            description:
              "The other bot's name, as listed in your instructions.",
          }),
          title: str({
            minLength: 1,
            maxLength: 80,
            description: "A short name for the task, shown to the owner.",
          }),
          brief,
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          // Task IDs repeat across bots, and the other bot keys its turns by
          // this ID. A replay of this call reuses the same one.
          const id = await api.memo("handoff-id", crypto.randomUUID(), ctx);
          return mutate(api, ctx, async (tx, sessionId, turnId) =>
            view(
              await handoffs.create(
                tx,
                {
                  id,
                  to: args.bot,
                  title: args.title.trim(),
                  brief: args.brief.trim(),
                },
                { sessionId, turnId },
              ),
            ),
          );
        },
      }),
      defineTool({
        name: "handoff_follow_up",
        description:
          "Send more instructions on a task you already handed off. The other bot continues in the same session, and its new result returns here as a new message.",
        parameters: obj({
          id: str({
            minLength: 1,
            maxLength: 100,
            description:
              "The handoff's ID from handoff_create or handoff_list.",
          }),
          brief,
        }),
        replay: "safe",
        execute: (args, api, ctx) =>
          mutate(api, ctx, async (tx, sessionId, turnId) =>
            view(
              await handoffs.followUp(tx, args.id, args.brief.trim(), {
                sessionId,
                turnId,
              }),
            ),
          ),
      }),
      defineTool({
        name: "handoff_list",
        description:
          "List the tasks this bot handed off, newest first, with their IDs and status. Does not change anything.",
        parameters: obj({}),
        replay: "safe",
        outputLimits: { maxBytes: 64000, maxLines: 1000 },
        execute: async () => ({
          output: [
            {
              type: "text",
              text: `[${(await handoffs.read()).reverse().slice(0, 30).map(view).join(",")}]`,
            },
          ],
        }),
      }),
    ],
  });
}
