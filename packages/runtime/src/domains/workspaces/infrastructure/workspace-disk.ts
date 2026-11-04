import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { InputError } from "../../../shared/application/input-error.ts";
import { syncDirectory } from "../../../shared/infrastructure/sync-directory.ts";
import {
  type Checkpoint,
  checkpointSchema,
  workspaceLimits,
} from "./workspace-protocol.ts";

/** Only used after native writers have been fenced. Never follow guest symlinks. */
export async function diskCheckpoint(root: string): Promise<Checkpoint> {
  const entries: Checkpoint = [];
  let bytes = 0;

  async function visit(relative: string) {
    const path = join(root, relative);
    const stat = await lstat(path);
    if (entries.length >= workspaceLimits.entries)
      throw new InputError(
        "Workspace exceeds just-bash's 1024-entry limit. Keep Container selected and reduce the workspace first.",
        409,
      );
    // Reserve an entry before recursion without reading unbounded file content.
    const index = entries.length;
    if (stat.isFile()) bytes += stat.size;
    if (bytes > workspaceLimits.fileBytes)
      throw new InputError(
        "Workspace exceeds just-bash's 8 MiB limit. Keep Container selected and reduce the workspace first.",
        409,
      );
    const kind = stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : undefined;
    if (!kind)
      throw new InputError(
        "Workspace contains a special file unsupported by just-bash.",
        409,
      );
    entries[index] = {
      path: relative ? `/workspace/${relative}` : "/workspace",
      kind,
      mode: stat.mode & 0xffff,
      mtime: stat.mtimeMs,
      content:
        kind === "file"
          ? (await readFile(path)).toString("base64")
          : kind === "symlink"
            ? await readlink(path)
            : "",
    };
    if (kind === "directory")
      for (const name of await readdir(path))
        await visit(relative ? `${relative}/${name}` : name);
  }

  await visit("");
  return validateCheckpoint(entries);
}

export function validateCheckpoint(entries: Checkpoint) {
  checkpointSchema.parse(entries);
  if (
    entries.reduce(
      (n, e) =>
        n + (e.kind === "file" ? Buffer.byteLength(e.content, "base64") : 0),
      0,
    ) > workspaceLimits.fileBytes ||
    Buffer.byteLength(JSON.stringify(entries)) > workspaceLimits.checkpointBytes
  )
    throw new InputError(
      "Workspace exceeds just-bash's checkpoint limits. Keep Container selected and reduce the workspace first.",
      409,
    );
  const byPath = new Map(entries.map((e) => [e.path, e]));
  if (byPath.size !== entries.length)
    throw new InputError("Duplicate workspace paths.");
  for (const entry of entries) {
    if (
      entry.path.includes("\0") ||
      entry.path.split("/").some((part) => Buffer.byteLength(part) > 255)
    )
      throw new InputError(
        "Workspace paths must be representable on disk (255 bytes per name, no NUL).",
        409,
      );
    if (entry.path === "/workspace") {
      if (entry.kind !== "directory")
        throw new InputError("Workspace root must be a directory.");
      continue;
    }
    for (
      let parent = entry.path.slice(0, entry.path.lastIndexOf("/"));
      parent !== "/workspace";
      parent = parent.slice(0, parent.lastIndexOf("/"))
    )
      if (byPath.get(parent)?.kind !== "directory")
        throw new InputError("Invalid workspace parent directory.");
  }
  return entries;
}

/** Recover the two-rename publication window before opening any native executor. */
export async function recoverDisk(directory: string) {
  const root = join(directory, "files");
  const backup = join(directory, "files.previous");
  if (!(await exists(root)) && (await exists(backup)))
    await rename(backup, root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (
    !(await lstat(root)).isDirectory() ||
    (await lstat(root)).isSymbolicLink()
  )
    throw new InputError("Invalid workspace storage directory.", 409);
  await rm(join(directory, "files.next"), { recursive: true, force: true });
}

async function exists(path: string) {
  return lstat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

/** SQLite remains the recovery journal while just-bash is selected. */
export async function publishCheckpoint(
  directory: string,
  entries: Checkpoint,
) {
  validateCheckpoint(entries);
  const next = join(directory, "files.next");
  const root = join(directory, "files");
  const previous = join(directory, "files.previous");
  await rm(next, { recursive: true, force: true });
  await mkdir(next, { mode: 0o700 });
  for (const entry of [...entries].sort(
    (a, b) => a.path.length - b.path.length,
  )) {
    if (entry.path === "/workspace") continue;
    const path = join(next, entry.path.slice("/workspace/".length));
    if (entry.kind === "directory") await mkdir(path, { recursive: true });
    else if (entry.kind === "file")
      await writeFile(path, Buffer.from(entry.content, "base64"), {
        mode: 0o600,
        flush: true,
      });
    else await symlink(entry.content, path);
  }
  for (const entry of entries
    .filter((e) => e.kind === "directory")
    .sort((a, b) => b.path.length - a.path.length))
    await syncDirectory(
      entry.path === "/workspace"
        ? next
        : join(next, entry.path.slice("/workspace/".length)),
    );
  await syncDirectory(next);
  for (const entry of [...entries].sort(
    (a, b) => b.path.length - a.path.length,
  ))
    if (entry.kind !== "symlink") {
      const path =
        entry.path === "/workspace"
          ? next
          : join(next, entry.path.slice("/workspace/".length));
      await chmod(path, entry.mode & 0o777);
      await utimes(path, new Date(entry.mtime), new Date(entry.mtime));
    }
  await rm(previous, { recursive: true, force: true });
  await rename(root, previous);
  await syncDirectory(directory);
  await rename(next, root);
  await syncDirectory(directory);
  await rm(previous, { recursive: true, force: true });
}

/** Preserve both legacy stores, relocating the checkpoint only when disk has data. */
export async function migrateCheckpoint(
  directory: string,
  entries: Checkpoint,
  target: "root" | "recovery",
) {
  const root = join(directory, "files");
  if (!entries.some((e) => e.path !== "/workspace")) return;
  if (target === "root") {
    await publishCheckpoint(directory, entries);
    return;
  }
  // A reserved recovery folder is never overwritten. The marker is committed only
  // after publication; retries compare the already materialized legacy snapshot.
  const recovery = join(root, ".recovered-just-bash");
  if (await exists(recovery)) {
    const saved = await diskCheckpoint(recovery);
    if (
      JSON.stringify(
        saved
          .map((e) => [e.path, e.kind, e.content])
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ) !==
      JSON.stringify(
        entries
          .map((e) => [e.path, e.kind, e.content])
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      )
    )
      throw new InputError(
        "Legacy workspace recovery folder already exists. Preserve it and rename it before retrying migration.",
        409,
      );
    return;
  }
  const temporary = join(directory, "legacy.next");
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { mode: 0o700 });
  await mkdir(join(temporary, "files"), { mode: 0o700 });
  await publishCheckpoint(temporary, entries);
  await rename(join(temporary, "files"), recovery);
  await syncDirectory(root);
  await rm(temporary, { recursive: true, force: true });
}
