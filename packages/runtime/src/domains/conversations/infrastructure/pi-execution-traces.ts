import type { AgentEvent } from "@earendil-works/pi-durable";

import type {
  Telemetry,
  TraceAttributes,
  TraceSpan,
} from "../../../shared/application/telemetry.ts";

/** Best-effort live observations, never reconstructed timings for historical work. */
export class ExecutionTraces {
  private run?: TraceSpan;
  private model?: TraceSpan;
  private retry?: TraceSpan;
  private attributes: TraceAttributes = {};
  private attempt = 1;
  private failed = false;

  private telemetry: Telemetry;
  private session: TraceAttributes;

  constructor(telemetry: Telemetry, session: TraceAttributes) {
    this.telemetry = telemetry;
    this.session = session;
  }

  accept(event: AgentEvent, turnId?: string) {
    if (event.type === "snapshot") {
      this.close();
      if (event.run) {
        this.beginRun(turnId, true);
        if (event.generation) {
          this.attempt = event.generation.attempt;
          if (event.generation.retry) {
            this.retry = this.telemetry.start(
              "model.retry",
              {
                ...this.attributes,
                "model.attempt": this.attempt,
                "execution.partial": true,
              },
              this.run,
            );
          } else this.beginModel(true);
          const message = event.generation.message;
          if (message)
            this.model?.annotate({
              "model.provider": message.provider,
              "model.id": message.model,
            });
        }
      }
    } else if (event.type === "run_start") this.beginRun(turnId);
    else if (event.type === "turn_start") {
      this.attempt = 1;
      this.beginModel();
    } else if (
      event.type === "message_start" &&
      event.message.role === "assistant"
    ) {
      this.model?.annotate({
        "model.provider": event.message.provider,
        "model.id": event.message.model,
      });
    } else if (event.type === "message_end") {
      const message = event.entry.model?.find((m) => m.role === "assistant");
      if (message?.role !== "assistant") return;
      this.failed =
        message.stopReason === "error" || message.stopReason === "aborted";
      this.model?.annotate({
        "model.provider": message.provider,
        "model.id": message.model,
        "model.stop_reason": message.stopReason,
        "model.input_tokens": message.usage.input,
        "model.output_tokens": message.usage.output,
        "model.cache_read_tokens": message.usage.cacheRead,
        "model.cache_write_tokens": message.usage.cacheWrite,
      });
      this.model?.end(this.failed ? "error" : "ok");
      this.model = undefined;
    } else if (event.type === "auto_retry_start") {
      this.model?.end("error");
      this.model = undefined;
      this.retry?.end("interrupted");
      this.retry = this.telemetry.start(
        "model.retry",
        { ...this.attributes, "model.attempt": event.attempt },
        this.run,
      );
    } else if (event.type === "auto_retry_end") {
      this.retry?.end();
      this.retry = undefined;
      this.attempt = event.attempt + 1;
      this.beginModel();
    } else if (event.type === "task_failed") {
      this.failed = true;
      this.model?.end("error");
      this.model = undefined;
    } else if (event.type === "turn_end") {
      if (this.model) this.failed = true;
      this.model?.end("error");
      this.model = undefined;
    } else if (event.type === "run_end") {
      const unfinished = !!this.model || !!this.retry;
      this.model?.end("interrupted");
      this.model = undefined;
      this.retry?.end("interrupted");
      this.retry = undefined;
      this.run?.end(unfinished ? "interrupted" : this.failed ? "error" : "ok");
      this.run = undefined;
    }
  }

  private beginRun(turnId?: string, partial = false) {
    this.close();
    this.failed = false;
    this.attributes = {
      ...this.session,
      ...(turnId ? { "turn.id": turnId } : {}),
    };
    this.run = this.telemetry.start("agent.run", {
      ...this.attributes,
      "execution.partial": partial,
    });
  }

  private beginModel(partial = false) {
    this.model?.end("interrupted");
    this.model = this.telemetry.start(
      "model.generate",
      {
        ...this.attributes,
        "model.attempt": this.attempt,
        "execution.partial": partial,
      },
      this.run,
    );
  }

  close() {
    this.model?.end("interrupted");
    this.retry?.end("interrupted");
    this.run?.end("interrupted");
    this.model = this.retry = this.run = undefined;
  }
}
