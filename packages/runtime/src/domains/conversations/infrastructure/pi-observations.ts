import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  AgentEventStream,
  ConversationId,
} from "@earendil-works/pi-durable";
import { watchEvents } from "@earendil-works/pi-durable";

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

export class Observations {
  app: DurableContext;
  streams = new Map<number, AgentEventStream>();
  live = new Map<number, LiveConversation>();
  traces = new Map<number, ExecutionTraces>();

  constructor(app: DurableContext) {
    this.app = app;
  }

  async attach(id: number) {
    if (this.streams.has(id)) return;
    const stream = await watchEvents(
      this.app.harness,
      id as ConversationId,
      context,
    );
    this.streams.set(id, stream);
    const snapshot = stream.snapshot;
    const state = await this.app.harness.snapshot(Chats, context);
    const session = state?.conversations.find((c) => c.id === id);
    const traces = new ExecutionTraces(
      this.app.telemetry,
      session ? { "session.id": session.sessionId } : {},
    );
    this.traces.set(id, traces);
    const observe = async (event: AgentEvent) => {
      let turnId: string | undefined;
      const inputs =
        event.type === "run_start"
          ? event.inputs
          : event.type === "snapshot"
            ? event.run?.inputs
            : undefined;
      if (inputs?.[0]) {
        const submission = await this.app.harness.submission(
          inputs[0],
          context,
        );
        turnId = (await submission?.status(context))?.requestId;
      }
      traces.accept(event, turnId);
    };
    await observe(snapshot);
    let content: AssistantMessage["content"] = structuredClone(
      snapshot.generation?.message?.content ?? [],
    );
    const text =
      snapshot.generation?.message?.content
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("") ?? "";
    this.live.set(id, {
      text,
      generating: !!snapshot.generation,
      usage: snapshot.usage,
    });
    stream.start(async (events) => {
      const live = this.live.get(id)!;
      const rows: {
        type: string;
        summary: string;
        details?: unknown;
        operationId?: string;
      }[] = [];
      for (const event of events) {
        await observe(event);
        if (event.type === "snapshot") {
          content = structuredClone(event.generation?.message?.content ?? []);
          live.text =
            event.generation?.message?.content
              .flatMap((p) => (p.type === "text" ? [p.text] : []))
              .join("") ?? "";
          live.generating = !!event.generation;
          live.usage = event.usage;
        } else if (
          event.type === "message_start" &&
          event.message.role === "assistant"
        ) {
          content = structuredClone(event.message.content);
          live.text = content
            .flatMap((p) => (p.type === "text" ? [p.text] : []))
            .join("");
          live.generating = true;
          rows.push({
            type: "model.started",
            summary: "Model response started",
            details: {
              provider: event.message.provider,
              model: event.message.model,
            },
          });
        } else if (event.type === "message_update") {
          for (const change of event.changes) {
            if ("block" in change)
              content[change.contentIndex] = structuredClone(change.block);
            if (change.type === "text_delta") {
              const block = content[change.contentIndex];
              if (block?.type === "text") block.text += change.delta;
            }
            if (change.type === "message")
              content = structuredClone(change.message.content);
            live.text = content
              .flatMap((p) => (p.type === "text" ? [p.text] : []))
              .join("");
          }
        } else if (event.type === "message_end") {
          const message = event.entry.model?.find(
            (m) => m.role === "assistant",
          );
          if (message?.role === "assistant") {
            live.text = message.content
              .flatMap((p) => (p.type === "text" ? [p.text] : []))
              .join("");
            live.generating = false;
            rows.push({
              type: "model.completed",
              summary: "Model response received",
              details: {
                usage: message.usage,
                stopReason: message.stopReason,
                errorMessage: message.errorMessage,
                content: message.content,
              },
            });
          }
        } else if (event.type === "usage_changed") live.usage = event.usage;
        else if (event.type === "auto_retry_start")
          rows.push({
            type: "model.retry",
            summary: "Model retry scheduled",
            details: { attempt: event.attempt, at: event.at },
          });
        else if (event.type === "tool_execution_start")
          rows.push({
            type: "tool.started",
            summary: `${event.toolName} started`,
            operationId: event.toolCallId,
            details: event.args,
          });
        else if (event.type === "tool_execution_end")
          rows.push({
            type: "tool.completed",
            summary: `${event.toolName} settled`,
            operationId: event.toolCallId,
          });
        else if (event.type === "task_failed")
          rows.push({
            type: "task.failed",
            summary: "Execution task failed",
            details: { taskId: event.taskId, kind: event.kind },
          });
      }
      if (rows.length)
        await this.app.root.commit(async (tx) => {
          const journal = await tx.doc(Activity);
          const chats = await tx.doc(Chats);
          const runId =
            chats.turns.find(
              (t) => t.conversationId === id && t.status === "pending",
            )?.id ?? chats.turns.findLast((t) => t.conversationId === id)?.id;
          for (const row of rows)
            record(journal, row.type, row.summary, {
              ...row,
              conversationId: id,
              runId,
            });
        }, context);
    });
  }

  async close() {
    await Promise.all(
      [...this.streams.values()].map((stream) => stream.stop()),
    );
    for (const traces of this.traces.values()) traces.close();
    this.traces.clear();
    this.streams.clear();
  }
}
