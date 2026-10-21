import { Activity as ActivityIcon, Download, Search } from "lucide-react";
import { useState } from "react";

import type { ActivityEvent } from "../../../infrastructure/http/api-client";
import { Button } from "../../../shared/ui/button";
import { CodeBlock } from "../../../shared/ui/code-block";
import { ScrollArea } from "../../../shared/ui/scroll-area";

export function Activity({
  events,
  full = false,
}: {
  events: ActivityEvent[];
  full?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const visible = events
    .filter((e) =>
      `${e.summary} ${e.type} ${e.runId ?? ""}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
    )
    .toReversed();

  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), events },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `raphie-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className={full ? "diagnostics" : "activity-panel"}
      aria-label="Activity journal"
    >
      <div className="panel-heading">
        <div>
          <h2>{full ? "Diagnostics" : "Activity"}</h2>
          <p>
            {full
              ? "A durable record of what happened, and when."
              : "Every step, as it happens."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Export diagnostics"
          onClick={download}
        >
          <Download size={16} />
        </Button>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input
          aria-label="Filter activity"
          placeholder="Filter events…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <div className="journal-meta">
        <span>{visible.length} events</span>
        <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
      </div>
      <ScrollArea className="activity-scroll" viewportLabel="Activity events">
        <div className="activity-list">
          {visible.length === 0 ? (
            <div className="activity-empty">
              <ActivityIcon size={22} />
              <p>
                {filter
                  ? "No matching events."
                  : "Activity will appear here when you start a conversation."}
              </p>
            </div>
          ) : (
            visible.map((event) => (
              <details className="event" key={event.id}>
                <summary>
                  <span
                    className={`event-dot ${event.type.includes("failed") || event.type.includes("uncertain") ? "event-error" : ""}`}
                  />
                  <span className="event-main">
                    <span>{event.summary}</span>
                    <time
                      dateTime={new Date(event.at).toISOString()}
                      title={new Date(event.at).toISOString()}
                    >
                      {new Date(event.at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                        fractionalSecondDigits: 3,
                      })}
                    </time>
                  </span>
                </summary>
                <div className="event-detail">
                  <dl>
                    <dt>Event</dt>
                    <dd>{event.type}</dd>
                    <dt>UTC</dt>
                    <dd>{new Date(event.at).toISOString()}</dd>
                    <dt>Run</dt>
                    <dd>{event.runId ?? "—"}</dd>
                    <dt>Attempt</dt>
                    <dd>{event.attemptId}</dd>
                    <dt>Operation</dt>
                    <dd>{event.operationId ?? "—"}</dd>
                    <dt>Plugin</dt>
                    <dd>{event.pluginId ?? "—"}</dd>
                  </dl>
                  <CodeBlock>
                    {JSON.stringify(JSON.parse(event.detailsJson), null, 2)}
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
