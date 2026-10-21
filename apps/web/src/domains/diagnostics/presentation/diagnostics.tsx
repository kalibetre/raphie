import {
  Activity,
  Download,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { CodeBlock } from "../../../shared/ui/code-block";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { useTraces } from "../infrastructure/use-traces";

export function Diagnostics() {
  const [hours, setHours] = useState<1 | 6 | 24>(1);
  const [filter, setFilter] = useState("");
  const traces = useTraces(hours);
  const data = traces.data;
  const ready = !traces.error && data?.state === "ready";
  const visible = (ready ? data.spans : []).filter((span) =>
    `${span.name} ${span.traceId} ${span.status} ${JSON.stringify(span.attributes)}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  function download() {
    if (!ready) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `raphie-traces-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="diagnostics" aria-label="OTLP trace diagnostics">
      <div className="panel-heading">
        <div>
          <h2>Diagnostics</h2>
          <p>Operation timings and failures from exported OTLP traces.</p>
        </div>
        <div className="trace-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh traces"
            disabled={traces.isFetching}
            onClick={() => void traces.refetch()}
          >
            <RefreshCw size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Export traces"
            disabled={!ready || !data.spans.length}
            onClick={download}
          >
            <Download size={16} />
          </Button>
        </div>
      </div>
      <div
        className="trace-controls"
        role="group"
        aria-label="Trace time window"
      >
        {([1, 6, 24] as const).map((window) => (
          <Button
            key={window}
            size="sm"
            variant={hours === window ? "secondary" : "ghost"}
            aria-pressed={hours === window}
            onClick={() => setHours(window)}
          >
            Last {window}h
          </Button>
        ))}
      </div>
      <label className="search-field">
        <Search size={14} />
        <input
          aria-label="Filter traces"
          placeholder="Filter by operation, trace or session…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="journal-meta">
        <span>{visible.length} spans · OTLP</span>
        <span>Latest {data?.spanLimit ?? 500} spans</span>
      </div>
      {ready && !data.exportEnabled && (
        <p className="trace-notice" role="status">
          Trace export is disabled. Showing retained traces only.
        </p>
      )}
      <ScrollArea className="activity-scroll" viewportLabel="Diagnostic traces">
        <div className="activity-list">
          {!ready || !visible.length ? (
            <div className="activity-empty" role="status">
              {traces.error || data?.state === "unavailable" ? (
                <TriangleAlert size={24} />
              ) : (
                <Activity size={24} />
              )}
              <strong>
                {traces.isPending
                  ? "Loading traces…"
                  : traces.error || data?.state === "unavailable"
                    ? "Trace backend unavailable"
                    : data?.state === "unconfigured"
                      ? "Trace backend not configured"
                      : filter
                        ? "No matching spans"
                        : "No exported traces in this window"}
              </strong>
              <p>
                {!ready
                  ? "Tracing is unavailable. Retry in a moment. Activity remains available in each session."
                  : "Completed spans appear after export. Session Activity retains the execution history."}
              </p>
            </div>
          ) : (
            visible.map((span) => (
              <details className="event" key={`${span.traceId}:${span.spanId}`}>
                <summary>
                  <span
                    className={`event-dot ${span.status === "error" ? "event-error" : ""}`}
                  />
                  <span className="event-main">
                    <span>{span.name}</span>
                    <span className="trace-timing">
                      {span.status === "error" ? "Error · " : ""}
                      {span.durationMs.toFixed(1)} ms
                    </span>
                    <time dateTime={new Date(span.startedAt).toISOString()}>
                      {new Date(span.startedAt).toLocaleTimeString()}
                    </time>
                  </span>
                </summary>
                <div className="event-detail">
                  <dl>
                    <dt>Trace</dt>
                    <dd>{span.traceId}</dd>
                    <dt>Span</dt>
                    <dd>{span.spanId}</dd>
                    <dt>Parent</dt>
                    <dd>{span.parentSpanId ?? "Root span"}</dd>
                    <dt>Status</dt>
                    <dd>
                      {span.status === "unset"
                        ? "No explicit status"
                        : span.status}
                    </dd>
                    <dt>Started</dt>
                    <dd>{new Date(span.startedAt).toISOString()}</dd>
                  </dl>
                  <CodeBlock>
                    {JSON.stringify(span.attributes, null, 2)}
                  </CodeBlock>
                </div>
              </details>
            ))
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
