import { redact } from "../../../shared/infrastructure/redaction.ts";

export {
  redact,
  registerRedactionSecret,
} from "../../../shared/infrastructure/redaction.ts";

import type { ActivityEvent } from "../domain/model.ts";

export type { ActivityEvent } from "../domain/model.ts";

import { defineDoc } from "@earendil-works/pi-durable";

type Journal = { next: number; events: ActivityEvent[] };

export const Activity = defineDoc<Journal>({
  kind: "raphie.activity",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ next: 1, events: [] }),
});

export const attemptId = crypto.randomUUID();

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
