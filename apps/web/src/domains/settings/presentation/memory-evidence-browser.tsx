import type {
  MemoryEvidence,
  MemoryPage,
  MemoryRecall,
} from "@raphie/contracts";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { MemoryEvidenceCard } from "./memory-evidence-card";
import { Group } from "./settings-group";

export function MemoryEvidenceBrowser({
  canManage,
  canBrowse,
  liveSearch,
  scope,
}: {
  canManage: boolean;
  canBrowse: boolean;
  liveSearch: boolean;
  scope: string;
}) {
  const { workspace } = useBackend();
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<MemoryEvidence[] | null>(null);
  const [page, setPage] = useState<Pick<MemoryPage, "next" | "total"> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<symbol | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtering = !!query.trim();
  const browsing = canBrowse && !filtering;

  const load = useCallback(
    async (after?: string) => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (!query.trim() && !canBrowse) return;
      const current = Symbol();
      request.current = current;
      setBusy(true);
      setError("");
      try {
        let result: MemoryRecall;
        let metadata: Pick<MemoryPage, "next" | "total"> | null = null;
        if (query.trim())
          result = await workspace.api<MemoryRecall>("/api/memory/recall", {
            query: query.trim(),
          });
        else {
          const listed = await workspace.api<MemoryPage>(
            `/api/memory/evidence${after ? `?after=${encodeURIComponent(after)}` : ""}`,
          );
          result = listed;
          metadata = { total: listed.total, next: listed.next };
        }
        if (current === request.current) {
          setEvidence((previous) =>
            after ? [...(previous ?? []), ...result.evidence] : result.evidence,
          );
          setPage(metadata);
        }
      } catch (error) {
        if (current === request.current) {
          if (!after) {
            setEvidence(null);
            setPage(null);
          }
          setError(
            error instanceof Error ? error.message : "Could not load memories.",
          );
        }
      } finally {
        if (current === request.current) setBusy(false);
      }
    },
    [canBrowse, query, workspace],
  );

  useEffect(() => {
    // A new query or scope retires the previous response before it can appear.
    request.current = null;
    setEvidence(null);
    setPage(null);
    setError("");
    setBusy(false);
    const pending =
      liveSearch && query.trim() ? setTimeout(() => void load(), 300) : null;
    timer.current = pending;
    if (canBrowse && !query.trim()) void load();
    return () => {
      if (pending !== null) clearTimeout(pending);
      request.current = null;
    };
  }, [canBrowse, liveSearch, load, query]);

  async function change(id: string, content?: string) {
    setBusy(true);
    setError("");
    const forget = content === undefined;
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
                : [{ ...item, content: content!, revision: item.revision + 1 }],
          ) ?? null,
      );
      if (forget)
        setPage((current) =>
          current
            ? { ...current, total: Math.max(0, current.total - 1) }
            : null,
        );
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Memory update failed.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  let feedback = "Enter keywords, then press Search to query the provider.";
  if (evidence)
    feedback =
      browsing && page
        ? `Showing ${evidence.length} of ${page.total} saved ${page.total === 1 ? "memory" : "memories"}`
        : `${evidence.length} matching ${evidence.length === 1 ? "memory" : "memories"}`;
  if (busy) feedback = "Loading memories…";
  if (error) feedback = error;

  return (
    <Group
      title={canBrowse ? "Saved memories" : "Search memories"}
      note={
        canBrowse
          ? `Scope: ${scope}. Newest saved evidence first. Open a source to see the original conversation.`
          : `Scope: ${scope}. This provider supports search; browsing all records is not available through Raphie yet.`
      }
    >
      <div className="settings-form">
        <form
          className="memory-search"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label htmlFor="memory-query">
            {canBrowse ? "Filter saved memories" : "Search memories"}
          </label>
          <div className="settings-actions">
            <Input
              id="memory-query"
              aria-describedby="memory-search-help"
              value={query}
              maxLength={2000}
              required={!canBrowse}
              disabled={busy}
              placeholder="A preference, person or experience…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy || (!filtering && !canBrowse)}
            >
              {browsing ? <RefreshCw size={14} /> : <Search size={14} />}
              {browsing ? "Refresh" : "Search"}
            </Button>
            {filtering && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setQuery("")}
              >
                Clear search
              </Button>
            )}
          </div>
        </form>
        <p id="memory-search-help">
          {liveSearch
            ? "Type to search, or clear the filter to browse all saved memories. Search returns up to eight matching records."
            : "Press Search or Enter to query the provider."}
        </p>
        <div role="status" className="memory-browse-status">
          {feedback}
          {error && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void load()}
            >
              Retry
            </Button>
          )}
        </div>
        {evidence?.length === 0 && (
          <div className="memory-empty">
            <BookOpen size={24} aria-hidden="true" />
            <h3>
              {browsing ? "No memories saved yet" : "No matching memories"}
            </h3>
            <p>
              {browsing
                ? "Ask Raphie to remember a useful fact or preference. Saved evidence will appear here."
                : "Try a word from the saved information, or clear the filter to browse."}
            </p>
          </div>
        )}
        {evidence?.map((item, index) => (
          <MemoryEvidenceCard
            key={canBrowse ? item.id : `${item.id}:${index}`}
            item={item}
            canManage={canManage}
            busy={busy}
            onRevise={change}
            onForget={(id) => change(id)}
          />
        ))}
        {browsing && page?.next && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (page.next) void load(page.next);
            }}
          >
            {busy ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </Group>
  );
}
