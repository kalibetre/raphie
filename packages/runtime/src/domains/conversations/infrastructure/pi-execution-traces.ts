import type { LiveState } from "@earendil-works/pi-durable";

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

  accept(live: LiveState | undefined, turnId?: string, partial = false) {
    const running = live?.run !== undefined;
    if (running && !this.run) this.beginRun(turnId, partial);
    if (!running && live?.runFailure) this.failed = true;

    const generation = live?.generation;
    if (generation?.retry) {
      this.model?.end("error");
      this.model = undefined;
      this.attempt = generation.attempt;
      this.retry ??= this.telemetry.start(
        "model.retry",
        {
          ...this.attributes,
          "model.attempt": this.attempt,
          "execution.partial": partial,
        },
        this.run,
      );
    } else if (generation) {
      this.retry?.end();
      this.retry = undefined;
      this.attempt = generation.attempt;
      if (!this.model) this.beginModel(partial);
      const message = generation.message;
      if (message)
        this.model?.annotate({
          "model.provider": message.provider,
          "model.id": message.model,
        });
    } else {
      this.model?.end(this.failed ? "error" : "ok");
      this.model = undefined;
      this.retry?.end(this.failed ? "error" : "interrupted");
      this.retry = undefined;
    }

    if (!running && this.run) {
      const unfinished = !!this.model || !!this.retry;
      this.model?.end("interrupted");
      this.model = undefined;
      this.retry?.end("interrupted");
      this.retry = undefined;
      this.run.end(unfinished ? "interrupted" : this.failed ? "error" : "ok");
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
