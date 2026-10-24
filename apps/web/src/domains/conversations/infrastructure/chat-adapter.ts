import { EventType, type StreamChunk } from "@tanstack/ai";
import type { SubscribeConnectionAdapter } from "@tanstack/ai-client";

import type { Snapshot } from "../../../infrastructure/http/api-client.ts";
import { api } from "../../../infrastructure/http/api-client.ts";

type PartialReply = { turnId: string; text: string };

export function transcript(
  state: Snapshot,
  conversationId: string,
  retained?: PartialReply,
): StreamChunk {
  const turns = state.turns.filter((t) => t.conversationId === conversationId);
  const active = turns.find((t) => t.status === "pending");
  const live = state.live[conversationId];
  const partialText =
    live?.generating && live.text
      ? live.text
      : retained && retained.turnId === active?.id
        ? retained.text
        : "";
  return {
    type: EventType.MESSAGES_SNAPSHOT,
    messages: turns.flatMap((turn) => [
      { id: turn.id, role: "user" as const, content: turn.text },
      ...(turn.answer
        ? [
            {
              id: `${turn.id}:reply`,
              role: "assistant" as const,
              content: turn.answer,
            },
          ]
        : turn.id === active?.id && partialText
          ? [
              {
                id: `${turn.id}:reply`,
                role: "assistant" as const,
                content: partialText,
              },
            ]
          : []),
    ]),
  };
}

// Pi owns durable execution; TanStack AI only projects our transcript for React.
// Unsubscribing never submits a cancellation or approval command.
export function chatAdapter(
  conversationId: string,
  subscribe: (listener: (state: Snapshot) => void) => () => void,
  sendRequest = api,
): SubscribeConnectionAdapter {
  return {
    async *subscribe(signal) {
      let latest: Snapshot | undefined;
      let wake: (() => void) | undefined;
      let partial: PartialReply | undefined;
      const remove = subscribe((state) => {
        latest = state;
        wake?.();
      });
      const abort = () => wake?.();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        while (!signal?.aborted) {
          if (!latest)
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          if (signal?.aborted) break;
          if (latest) {
            const state = latest;
            latest = undefined;
            const active = state.turns.find(
              (turn) =>
                turn.conversationId === conversationId &&
                turn.status === "pending",
            );
            if (partial?.turnId !== active?.id) partial = undefined;
            const live = state.live[conversationId];
            if (active && live?.generating && live.text)
              partial = { turnId: active.id, text: live.text };
            // A turn can span multiple model/tool steps. Empty step boundaries
            // must not remove an already visible reply while the turn continues.
            yield transcript(state, conversationId, partial);
          }
        }
      } finally {
        remove();
        signal?.removeEventListener("abort", abort);
      }
    },
    async send(messages) {
      const message = messages.at(-1);
      if (!message || message.role !== "user")
        throw new Error("Write a message to send.");
      const text =
        "parts" in message
          ? message.parts
              .flatMap((p) => (p.type === "text" ? [p.content] : []))
              .join("")
          : typeof message.content === "string"
            ? message.content
            : "";
      await sendRequest("/api/sessions/messages", {
        eventId: message.id ?? crypto.randomUUID(),
        text,
        sessionId: conversationId,
      });
    },
  };
}
