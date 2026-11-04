import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  ConversationView,
  ConversationWatch,
  LiveState,
  UsageState,
} from "@earendil-works/pi-durable";

import type { DurableContext } from "../../../shared/infrastructure/durable-context.ts";
import {
  Activity,
  record,
} from "../../activity/infrastructure/pi-activity-journal.ts";
import { Chats } from "./pi-conversation-service.ts";
import { ExecutionTraces } from "./pi-execution-traces.ts";

export type LiveConversation = {
  text: string;
  generating: boolean;
  usage: unknown;
};

type ActivityRow = {
  type: string;
  summary: string;
  details?: unknown;
  operationId?: string;
};

export class Observations {
  app: DurableContext;
  streams = new Map<number, ConversationWatch>();
  live = new Map<number, LiveConversation>();
  traces = new Map<number, ExecutionTraces>();
  private states = new Map<number, LiveState | undefined>();

  constructor(app: DurableContext) {
    this.app = app;
  }

  async attach(id: number) {
    if (this.streams.has(id)) return;
    const conversationId = id as ConversationId;
    const conversation = await this.app.harness.conversation(
      conversationId,
      context,
    );
    if (!conversation) return;

    const stream = await conversation.watch(context);
    this.streams.set(id, stream);
    const state = await this.app.harness.snapshot(Chats, context);
    const session = state?.conversations.find((item) => item.id === id);
    const traces = new ExecutionTraces(
      this.app.telemetry,
      session ? { "session.id": session.sessionId } : {},
    );
    this.traces.set(id, traces);

    const update = async (view: ConversationView, initial = false) => {
      const previous = this.states.get(id);
      const next = view.docs["pi.live"] as LiveState | undefined;
      const input = next?.run?.inputs[0];
      let turnId: string | undefined;
      if (input) {
        const submission = await this.app.harness.submission(input, context);
        turnId = (await submission?.status(context))?.requestId;
      }
      traces.accept(next, turnId, initial);

      const message = next?.generation?.message as AssistantMessage | undefined;
      const text =
        message?.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("") ?? "";
      this.live.set(id, {
        text,
        generating: !!next?.generation,
        usage: (view.docs["pi.usage"] as UsageState | undefined) ?? null,
      });
      this.states.set(id, next);

      const rows = initial ? [] : this.activityRows(previous, next);
      if (rows.length)
        await this.app.root.commit(async (tx) => {
          const journal = await tx.doc(Activity);
          const chats = await tx.doc(Chats);
          const runId =
            chats.turns.find(
              (turn) => turn.conversationId === id && turn.status === "pending",
            )?.id ??
            chats.turns.findLast((turn) => turn.conversationId === id)?.id;
          for (const row of rows)
            record(journal, row.type, row.summary, {
              ...row,
              conversationId: id,
              runId,
            });
        }, context);
    };

    await update(stream.value, true);
    stream.start(async (call) => {
      if (call.kind === "value") await update(call.value);
    });
  }

  private activityRows(
    previous: LiveState | undefined,
    next: LiveState | undefined,
  ): ActivityRow[] {
    const rows: ActivityRow[] = [];
    if (!previous?.generation && next?.generation)
      rows.push({ type: "model.started", summary: "Model response started" });
    if (previous?.generation && !next?.generation) {
      const message = previous.generation.message as
        AssistantMessage | undefined;
      rows.push({
        type: "model.completed",
        summary: "Model response received",
        details: message
          ? {
              usage: message.usage,
              stopReason: message.stopReason,
              errorMessage: message.errorMessage,
              content: message.content,
            }
          : undefined,
      });
    }
    if (
      next?.generation?.retry &&
      (!previous?.generation?.retry ||
        previous.generation.attempt !== next.generation.attempt)
    )
      rows.push({
        type: "model.retry",
        summary: "Model retry scheduled",
        details: {
          attempt: next.generation.attempt,
          at: next.generation.retry.at,
        },
      });

    const priorTools = new Map(
      [...(previous?.tools ?? []), ...(previous?.nestedTools ?? [])].map(
        (tool) => [tool.callId, tool.status],
      ),
    );
    for (const tool of [...(next?.tools ?? []), ...(next?.nestedTools ?? [])]) {
      const prior = priorTools.get(tool.callId);
      if (tool.status === "running" && prior !== "running")
        rows.push({
          type: "tool.started",
          summary: `${tool.name} started`,
          operationId: tool.callId,
          details: "arguments" in tool ? tool.arguments : undefined,
        });
      if (tool.status === "done" && prior !== "done")
        rows.push({
          type: "tool.completed",
          summary: `${tool.name} settled`,
          operationId: tool.callId,
        });
    }

    if (
      next?.runFailure &&
      previous?.runFailure?.taskId !== next.runFailure.taskId
    )
      rows.push({
        type: "task.failed",
        summary: "Execution task failed",
        details: {
          taskId: next.runFailure.taskId,
          reason: next.runFailure.reason,
        },
      });
    return rows;
  }

  async close() {
    await Promise.all(
      [...this.streams.values()].map((stream) => stream.stop()),
    );
    for (const traces of this.traces.values()) traces.close();
    this.traces.clear();
    this.streams.clear();
    this.states.clear();
  }
}
