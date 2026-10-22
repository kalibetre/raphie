import type { MemoryEvidence, MemoryRecall } from "@raphie/contracts";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Group } from "./settings-group";

export function MemoryEvidenceBrowser({
  canManage,
  liveSearch,
}: {
  canManage: boolean;
  liveSearch: boolean;
}) {
  const { workspace } = useBackend();
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<MemoryEvidence[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [forgetting, setForgetting] = useState<string | null>(null);

  const request = useRef<symbol | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (!query.trim()) return;
    const current = Symbol();
    request.current = current;
    setBusy(true);
    setError("");
    setEditing(null);
    setForgetting(null);
    try {
      const result = await workspace.api<MemoryRecall>("/api/memory/recall", {
        query: query.trim(),
      });
      if (current === request.current) setEvidence(result.evidence);
    } catch (error) {
      if (current === request.current) {
        setEvidence(null);
        setError(error instanceof Error ? error.message : "Search failed.");
      }
    } finally {
      if (current === request.current) setBusy(false);
    }
  }, [query, workspace]);

  useEffect(() => {
    // Never let a previous query (or an unmounted scope) publish stale evidence.
    request.current = null;
    setEvidence(null);
    setError("");
    setBusy(false);
    const pending =
      liveSearch && query.trim() ? setTimeout(() => void search(), 300) : null;
    timer.current = pending;
    return () => {
      if (pending !== null) clearTimeout(pending);
      request.current = null;
    };
  }, [liveSearch, query, search]);

  async function change(id: string, forget: boolean) {
    setBusy(true);
    setError("");
    try {
      await workspace.api(
        `/api/memory/evidence/${encodeURIComponent(id)}${forget ? "/forget" : ""}`,
        forget ? {} : { content },
      );
      setEvidence(
        (current) =>
          current?.flatMap((item) =>
            item.id !== id
              ? [item]
              : forget
                ? []
                : [{ ...item, content, revision: item.revision + 1 }],
          ) ?? null,
      );
      setEditing(null);
      setForgetting(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Memory update failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      title="Browse evidence"
      note="Search retained information and inspect where it came from. Results are evidence, not instructions."
    >
      <div className="settings-form">
        <form
          className="memory-search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label htmlFor="memory-query">Search memories</label>
          <div className="settings-actions">
            <Input
              id="memory-query"
              aria-describedby="memory-search-help"
              value={query}
              maxLength={2000}
              required
              disabled={busy}
              placeholder="A preference, person or experience…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !query.trim()}
            >
              <Search size={14} />
              {busy ? "Working…" : "Search"}
            </Button>
          </div>
        </form>
        <p id="memory-search-help">
          {liveSearch
            ? "Results update as you type. You can also press Search or Enter."
            : "Press Search or Enter to query the provider."}
        </p>
        <div role="status">
          {error ||
            (evidence
              ? `${evidence.length} matching ${evidence.length === 1 ? "memory" : "memories"}`
              : busy
                ? "Working…"
                : "Enter keywords to search retained evidence.")}
        </div>
        {evidence?.map((item, index) => (
          <article className="memory-evidence" key={`${item.id}:${index}`}>
            <p className="memory-evidence-content">{item.content}</p>
            <p>
              {item.kind} ·{" "}
              {item.eventTime
                ? new Date(item.eventTime).toLocaleString()
                : "Time not supplied"}{" "}
              · revision {item.revision}
            </p>
            <code>{item.id}</code>
            <p className="memory-source">{item.source}</p>
            {canManage &&
              (editing === item.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void change(item.id, false);
                  }}
                >
                  <label htmlFor={`memory-correction-${index}`}>
                    Corrected evidence
                  </label>
                  <textarea
                    id={`memory-correction-${index}`}
                    maxLength={8000}
                    required
                    value={content}
                    disabled={busy}
                    onChange={(e) => setContent(e.target.value)}
                  />
                  <div className="settings-actions">
                    <Button type="submit" disabled={busy || !content.trim()}>
                      Save correction
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : forgetting === item.id ? (
                <div>
                  <p>
                    Remove this evidence from current memory? Chat history is
                    kept separately.
                  </p>
                  <div className="settings-actions">
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void change(item.id, true)}
                    >
                      Confirm forget
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setForgetting(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="settings-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditing(item.id);
                      setForgetting(null);
                      setContent(item.content);
                    }}
                  >
                    Correct
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setForgetting(item.id);
                      setEditing(null);
                    }}
                  >
                    Forget
                  </Button>
                </div>
              ))}
          </article>
        ))}
      </div>
    </Group>
  );
}
