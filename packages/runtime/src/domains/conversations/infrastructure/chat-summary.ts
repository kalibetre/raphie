import type { Message } from "@earendil-works/pi-ai";
import {
  CompactionTask,
  defineExtension,
  hook,
} from "@earendil-works/pi-durable";

import {
  compactionPolicy,
  SUMMARY_INSTRUCTIONS,
  summaryText,
} from "../domain/compaction.ts";
import { Chats } from "./pi-conversation-service.ts";

/** The most of one tool result the summarizer reads. */
const TOOL_RESULT_CHARS = 2_000;

/**
 * Summaries of a session's earlier messages, written as a teammate's notes
 * by the session's own model. When the model is unknown or its answer is not
 * a summary, the hook throws and Pi writes its own summary instead.
 */
export const chatSummaries = defineExtension({
  name: "raphie.chat-summaries",
  hooks: [
    hook(CompactionTask, {
      async beforeCompact(compaction, api, context) {
        // A summary written before a crash is placed, not paid for twice.
        const written = await api.memo<string>("summary", context);
        if (written !== undefined) return { summary: written };
        const selection = (
          await api.snapshot(Chats, context)
        )?.conversations.find((c) => c.id === api.conversationId)?.model;
        const model =
          selection &&
          api.models.getModel(selection.provider, selection.modelId);
        if (!model)
          throw new Error("The session's model is unknown; Pi summarizes.");
        const reply = await api.models.completeSimple(
          model,
          {
            systemPrompt: SUMMARY_INSTRUCTIONS,
            messages: [
              {
                role: "user",
                content: `<transcript>\n${transcript(compaction.messages)}\n</transcript>`,
                timestamp: api.now(),
              },
            ],
          },
          {
            cacheRetention: "none",
            maxTokens: Math.min(
              Math.floor(
                0.8 * compactionPolicy(model.contextWindow).reserveTokens,
              ),
              model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
            ),
          },
        );
        const summary = reply.content
          .flatMap((c) => (c.type === "text" ? [c.text] : []))
          .join("\n")
          .trim();
        if (reply.stopReason !== "stop" || !summary)
          throw new Error(
            `No summary (${reply.errorMessage ?? reply.stopReason}); Pi summarizes.`,
          );
        return { summary: await api.memo("summary", summary, context) };
      },
    }),
  ],
});

/**
 * Messages as a plain transcript, so the summarizer reads them instead of
 * carrying on: who said what, the tools called, and the start of each
 * result. An earlier summary leads, marked as the notes it is.
 */
export function transcript(messages: readonly Message[]) {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = textOf(message.content);
      if (!text) continue;
      const notes = summaryText(text);
      lines.push(
        // Not always the owner: also a scheduled job, a group or another bot.
        notes === text ? `[Message]: ${text}` : `[Earlier notes]:\n${notes}`,
      );
    } else if (message.role === "assistant") {
      const text = message.content
        .flatMap((c) => (c.type === "text" ? [c.text] : []))
        .join("\n");
      if (text) lines.push(`[Assistant]: ${text}`);
      for (const call of message.content)
        if (call.type === "toolCall")
          lines.push(
            `[Assistant calls ${call.name}]: ${JSON.stringify(call.arguments)}`,
          );
    } else if (message.role === "toolResult") {
      const text = textOf(message.content);
      if (text)
        lines.push(
          `[Result of ${message.toolName}]: ${
            text.length > TOOL_RESULT_CHARS
              ? `${text.slice(0, TOOL_RESULT_CHARS)} […]`
              : text
          }`,
        );
    }
  }
  return lines.join("\n\n");
}

function textOf(content: string | readonly { type: string; text?: string }[]) {
  return typeof content === "string"
    ? content
    : content
        .flatMap((c) => (c.type === "text" && c.text ? [c.text] : []))
        .join("\n");
}
