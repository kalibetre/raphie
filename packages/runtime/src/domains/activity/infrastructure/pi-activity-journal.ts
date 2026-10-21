import type { ActivityEvent } from "../domain/model.ts";

export type { ActivityEvent } from "../domain/model.ts";

import { defineDoc } from "@earendil-works/pi-durable";

type Journal = { next: number; events: ActivityEvent[] };

export const Activity = defineDoc<Journal>({
  kind: "raphie.activity",
  version: 1,
  scope: "session",
  initial: () => ({ next: 1, events: [] }),
});

export const attemptId = crypto.randomUUID();

// Redact before persistence, including values accidentally embedded in error text.
export function redact(value: unknown): string {
  const secrets = [
    "OPENROUTER_API_KEY",
    "MCP_BEARER_TOKEN",
    "DISCORD_BOT_TOKEN",
  ]
    .map((key) => process.env[key])
    .filter((v): v is string => !!v);
  let text =
    JSON.stringify(value, (key, val) =>
      /authorization|api.?key|token|secret|password/i.test(key) &&
      !/tokens|tokenCount/i.test(key)
        ? "[redacted]"
        : val,
    ) ?? "null";
  for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
  return text.length > 24_000
    ? JSON.stringify({ preview: text.slice(0, 24_000), truncated: true })
    : text;
}

export function record(
  state: Journal,
  type: string,
  summary: string,
  context: {
    conversationId?: number;
    runId?: string;
    operationId?: string;
    pluginId?: string;
    details?: unknown;
  } = {},
) {
  state.events.push({
    id: state.next++,
    at: Date.now(),
    attemptId,
    type,
    summary,
    conversationId: context.conversationId ?? null,
    runId: context.runId ?? null,
    operationId: context.operationId ?? null,
    pluginId: context.pluginId ?? null,
    detailsJson: redact(context.details ?? {}),
  });
  // Bounded first-release retention; export before older events leave this journal.
  if (state.events.length > 5000)
    state.events.splice(0, state.events.length - 5000);
}
