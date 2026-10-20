import type { SubscribeConnectionAdapter } from "@tanstack/ai-client";
import { EventType, type StreamChunk } from "@tanstack/ai";
import type { Snapshot } from "./api.ts";
import { api } from "./api.ts";

export function transcript(
  state: Snapshot,
  conversationId: number,
): StreamChunk {
  const turns = state.turns.filter((t) => t.conversationId === conversationId);
  const active = turns.find((t) => t.status === "pending");
  const live = state.live[conversationId];
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
        : turn.id === active?.id && live?.generating && live.text
          ? [
              {
                id: `${turn.id}:reply`,
                role: "assistant" as const,
                content: live.text,
              },
            ]
          : []),
    ]),
  };
}

// Pi owns durable execution; TanStack AI only projects our transcript for React.
// Unsubscribing never submits a cancellation or approval command.
export function chatAdapter(
  conversationId: number,
  subscribe: (listener: (state: Snapshot) => void) => () => void,
): SubscribeConnectionAdapter {
  return {
    async *subscribe(signal) {
      let latest: Snapshot | undefined;
      let wake: (() => void) | undefined;
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
            yield transcript(state, conversationId);
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
      await api("/api/chat", {
        eventId: message.id ?? crypto.randomUUID(),
        text,
        conversationId,
      });
    },
  };
}
