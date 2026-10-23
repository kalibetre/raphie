import type { MemoryEvidence } from "@raphie/contracts";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";

export function MemoryEvidenceCard({
  item,
  canManage,
  busy,
  onRevise,
  onForget,
}: {
  item: MemoryEvidence;
  canManage: boolean;
  busy: boolean;
  onRevise: (id: string, content: string) => Promise<boolean>;
  onForget: (id: string) => Promise<boolean>;
}) {
  const field = useId();
  const { workspace } = useBackend();
  const [mode, setMode] = useState<"view" | "edit" | "forget">("view");
  const [content, setContent] = useState(item.content);
  const session =
    /^session:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/turn:/i.exec(
      item.source,
    )?.[1];
  let controls = null;
  if (canManage) {
    if (mode === "edit")
      controls = (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onRevise(item.id, content.trim()).then((saved) => {
              if (saved) setMode("view");
            });
          }}
        >
          <label htmlFor={field}>Corrected evidence</label>
          <textarea
            id={field}
            maxLength={8000}
            required
            value={content}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="settings-actions">
            <Button type="submit" disabled={busy || !content.trim()}>
              Save correction
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setMode("view")}
            >
              Cancel
            </Button>
          </div>
        </form>
      );
    else if (mode === "forget")
      controls = (
        <div>
          <p>
            Remove this evidence from current memory? Chat history is kept
            separately.
          </p>
          <div className="settings-actions">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void onForget(item.id).then((saved) => {
                  if (saved) setMode("view");
                });
              }}
            >
              Confirm forget
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setMode("view")}
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    else
      controls = (
        <div className="settings-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setContent(item.content);
              setMode("edit");
            }}
          >
            Correct
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setMode("forget")}
          >
            Forget
          </Button>
        </div>
      );
  }
  return (
    <article className="memory-evidence">
      <div className="memory-record-meta">
        <span className="memory-kind">{item.kind}</span>
        <span>
          {item.eventTime
            ? new Date(item.eventTime).toLocaleString()
            : "Time not supplied"}
        </span>
        <span>revision {item.revision}</span>
      </div>
      <p className="memory-evidence-content">{item.content}</p>
      <details className="memory-record-source">
        <summary>Source and record ID</summary>
        <code>{item.id}</code>
        <p className="memory-source">{item.source}</p>
        {session && (
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: session }}
            search={{
              bot: workspace.botId === "default" ? undefined : workspace.botId,
            }}
          >
            Open source session
          </Link>
        )}
      </details>
      {controls}
    </article>
  );
}
