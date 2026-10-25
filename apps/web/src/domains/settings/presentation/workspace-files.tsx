import type { WorkspaceEntry, WorkspaceListing } from "@raphie/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Download, File, Folder, Link, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { downloadWorkspaceFile } from "../infrastructure/download-workspace-file";
import {
  formatWorkspaceBytes as bytes,
  useSandbox,
} from "../infrastructure/use-sandbox";
import { Group } from "./settings-group";

export function WorkspaceFiles({ onSandbox }: { onSandbox: () => void }) {
  const { workspace } = useBackend();
  const sandbox = useSandbox();
  const [path, setPath] = useState("/workspace");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const location = useRef<HTMLParagraphElement>(null);
  const previous = useRef(path);
  const listing = useQuery({
    queryKey: ["workspace-files", path],
    queryFn: () =>
      workspace.api<WorkspaceListing>(
        `/api/workspace/files?path=${encodeURIComponent(path)}`,
      ),
    refetchInterval: 5000,
    retry: false,
  });
  useEffect(() => {
    if (previous.current !== path) {
      location.current?.focus();
      previous.current = path;
    }
  }, [path]);

  function open(next: string) {
    setPath(next);
    setError("");
  }

  async function download(file: WorkspaceEntry) {
    if (!listing.data) return;
    setBusy(file.path);
    setError("");
    try {
      await downloadWorkspaceFile(workspace, file, listing.data.revision);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not download this file.",
      );
    } finally {
      setBusy("");
    }
  }

  const container = sandbox.data?.provider.id === "container";
  const parent = path.slice(0, path.lastIndexOf("/"));
  return (
    <>
      <Group
        title="Workspace files"
        note={
          container
            ? "Browse live container files. Writes can appear even when a command fails. Downloads are limited to 8 MiB; files may change while processes run."
            : "Browse and download the last committed files. New files appear after the bot’s command finishes successfully."
        }
        action={
          <Button variant="ghost" size="sm" onClick={onSandbox}>
            Sandbox details
          </Button>
        }
      >
        <div className="workspace-file-toolbar">
          <nav aria-label="Workspace folders">
            {path
              .split("/")
              .filter(Boolean)
              .map((part, i, parts) => (
                <Button
                  key={i}
                  variant="ghost"
                  size="sm"
                  aria-current={i === parts.length - 1 ? "location" : undefined}
                  disabled={i === parts.length - 1}
                  onClick={() => open(`/${parts.slice(0, i + 1).join("/")}`)}
                >
                  {i === 0 ? "/workspace" : part}
                </Button>
              ))}
          </nav>
          <div className="workspace-file-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={path === "/workspace"}
              aria-label="Parent folder"
              onClick={() => open(parent)}
            >
              <ArrowUp size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={listing.isFetching}
              aria-label="Refresh workspace files"
              onClick={() => {
                setError("");
                void listing.refetch();
                void sandbox.refetch();
              }}
            >
              <RefreshCw size={15} />
            </Button>
          </div>
        </div>
        <p className="workspace-file-location" ref={location} tabIndex={-1}>
          {path}
        </p>
        {error && (
          <p className="workspace-file-notice settings-error" role="alert">
            {error}
          </p>
        )}
        {listing.error && (
          <p className="workspace-file-notice" role="alert">
            {listing.error.message} Use Refresh to retry or open a parent
            folder.
          </p>
        )}
        {!listing.data && !listing.error && (
          <p className="workspace-file-notice" role="status">
            Loading files…
          </p>
        )}
        {listing.data && (
          <>
            <p className="workspace-file-summary" role="status">
              {listing.data.items.length}{" "}
              {listing.data.items.length === 1 ? "item" : "items"} ·{" "}
              {container ? "Live listing" : "Checkpoint"}{" "}
              {listing.data.revision}
              {sandbox.data
                ? ` · ${bytes(sandbox.data.usage.fileBytes)}${sandbox.data.limits.fileBytes === null ? " · No disk quota" : ` of ${bytes(sandbox.data.limits.fileBytes)}`}`
                : ""}
            </p>
            {listing.data.items.length ? (
              <ul
                className="workspace-file-list"
                aria-label={`Files in ${path}`}
              >
                {listing.data.items.map((entry) => (
                  <li key={entry.path}>
                    <span aria-hidden="true">
                      {entry.kind === "directory" ? (
                        <Folder size={17} />
                      ) : entry.kind === "symlink" ? (
                        <Link size={17} />
                      ) : (
                        <File size={17} />
                      )}
                    </span>
                    <div className="workspace-file-name">
                      {entry.kind === "directory" ? (
                        <button type="button" onClick={() => open(entry.path)}>
                          {entry.name}
                        </button>
                      ) : (
                        <strong>{entry.name}</strong>
                      )}
                      <small>
                        {entry.kind === "directory"
                          ? "Folder"
                          : entry.kind === "symlink"
                            ? "Symbolic link · not followed"
                            : bytes(entry.bytes)}{" "}
                        · {new Date(entry.modifiedAt).toLocaleString()}
                      </small>
                    </div>
                    {entry.kind === "file" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!!busy || !!listing.error}
                        aria-label={`Download ${entry.name}`}
                        onClick={() => void download(entry)}
                      >
                        <Download size={16} />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="workspace-file-notice">
                This folder is empty. Ask the bot to create a file in
                /workspace, then refresh.
              </p>
            )}
          </>
        )}
        {busy && (
          <p className="workspace-file-notice" role="status">
            Downloading…
          </p>
        )}
      </Group>
    </>
  );
}
