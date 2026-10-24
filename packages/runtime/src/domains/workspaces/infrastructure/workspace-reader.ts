import type { SandboxInfo, WorkspaceListing } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  type Checkpoint,
  checkpointSchema,
  workspaceLimits as limits,
} from "./workspace-protocol.ts";

export function workspacePath(path: string) {
  if (
    path.length > 1024 ||
    path.includes("\0") ||
    !(
      path === "/workspace" ||
      (path.startsWith("/workspace/") &&
        !path
          .split("/")
          .slice(1)
          .some((s) => s === ".." || s === "." || s === ""))
    )
  )
    throw new InputError("Choose a path inside /workspace.");
  return path;
}

export function readCheckpoint(checkpoint: string) {
  return checkpointSchema.parse(JSON.parse(checkpoint));
}

export function sandboxInfo(
  checkpoint: Checkpoint,
  revision: number,
  receiptBytes: number,
  admitted: number,
): SandboxInfo {
  return {
    provider: { id: "just-bash", name: "just-bash", version: "3.6.0" },
    isolation: "virtual-filesystem",
    capabilities: { network: false, hostFiles: false, nativeCode: false },
    root: "/workspace",
    revision,
    executions: {
      admitted,
      capacity: limits.queued,
      runtimeConcurrency: limits.concurrent,
    },
    usage: {
      fileBytes: checkpoint.reduce(
        (bytes, e) =>
          bytes +
          (e.kind === "file" ? Buffer.byteLength(e.content, "base64") : 0),
        0,
      ),
      entries: checkpoint.length,
      receiptBytes,
    },
    limits,
  };
}

export function listWorkspace(
  checkpoint: Checkpoint,
  revision: number,
  path: string,
): WorkspaceListing {
  workspacePath(path);
  if (
    path !== "/workspace" &&
    !checkpoint.some((e) => e.path === path && e.kind === "directory")
  )
    throw new InputError(
      "Workspace folder not found. Refresh the file list.",
      404,
    );
  return {
    path,
    revision,
    items: checkpoint
      .filter(
        (e) =>
          e.path.startsWith(`${path}/`) &&
          !e.path.slice(path.length + 1).includes("/"),
      )
      .map((e) => ({
        path: e.path,
        name: e.path.slice(path.length + 1),
        kind: e.kind,
        bytes: e.kind === "file" ? Buffer.byteLength(e.content, "base64") : 0,
        modifiedAt: e.mtime,
      }))
      .sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name),
      ),
  };
}

export function downloadWorkspaceFile(checkpoint: Checkpoint, path: string) {
  workspacePath(path);
  const file = checkpoint.find((e) => e.path === path);
  if (!file)
    throw new InputError(
      "Workspace file not found. Refresh the file list.",
      404,
    );
  if (file.kind !== "file")
    throw new InputError(
      "Only regular files can be downloaded. Symbolic links are not followed.",
    );
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    bytes: Buffer.from(file.content, "base64"),
  };
}
