import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type {
  ExecutionEnv,
  FileError,
  Result,
} from "@earendil-works/pi-durable/env";
import type { WorkspaceListing } from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { workspacePath } from "./workspace-reader.ts";

const maxEntries = 4096;
const downloadBytes = 8 * 1024 * 1024;

function getOrThrow<T>(result: Result<T, FileError>): T {
  if (result.ok) return result.value;
  throw new InputError(
    result.error.code === "not_found"
      ? "Workspace file or folder not found."
      : "Workspace files are unavailable. Refresh and try again.",
    result.error.code === "not_found" ? 404 : 409,
  );
}

/** Owner browsing uses the same guest filesystem as tools; no host path is opened. */
export class ContainerFiles {
  private readonly env: ExecutionEnv;

  constructor(env: ExecutionEnv) {
    this.env = env;
  }

  private async regularPath(path: string) {
    workspacePath(path);
    const resolved = getOrThrow(await this.env.canonicalPath(path, context));
    if (resolved !== path)
      throw new InputError(
        "Symbolic links are not followed in the file browser.",
      );
  }

  async list(path = "/workspace"): Promise<WorkspaceListing> {
    await this.regularPath(path);
    const reader = getOrThrow(await this.env.openDirReader(path, context));
    const items: WorkspaceListing["items"] = [];
    try {
      while (true) {
        const page = getOrThrow(await reader.next(256, context));
        for (const entry of page.entries) {
          // A compromised guest's names are data, never new host capabilities.
          if (
            !entry.name ||
            entry.name.includes("/") ||
            entry.name === "." ||
            entry.name === ".."
          )
            throw new InputError("Invalid workspace entry.");
          items.push({
            name: entry.name,
            path: `${path}/${entry.name}`,
            kind: entry.kind,
            bytes: entry.size,
            modifiedAt: entry.mtimeMs,
          });
        }
        if (items.length > maxEntries)
          throw new InputError(
            "This folder exceeds the 4096-entry browser limit. Use the bot's coding tools to inspect it.",
          );
        if (page.done) break;
      }
    } finally {
      await reader.close(context);
    }
    items.sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        a.name.localeCompare(b.name),
    );
    // Live directory metadata, not a checkpoint. Recheck it at download time.
    const revision = Number.parseInt(
      new Bun.CryptoHasher("sha256")
        .update(JSON.stringify([path, items]))
        .digest("hex")
        .slice(0, 12),
      16,
    );
    return { path, items, revision };
  }

  async download(path: string, revision: number) {
    workspacePath(path);
    const parent = path.slice(0, path.lastIndexOf("/"));
    const listing = await this.list(parent);
    if (listing.revision !== revision)
      throw new InputError(
        "Workspace changed since this list was loaded. Refresh before downloading.",
        409,
      );
    const entry = listing.items.find((item) => item.path === path);
    if (!entry) throw new InputError("Workspace file not found.", 404);
    if (entry.kind !== "file")
      throw new InputError(
        "Only regular files can be downloaded. Symbolic links are not followed.",
      );
    await this.regularPath(path);
    const reader = getOrThrow(
      await this.env.openBinaryReader(path, { noFollow: true }, context),
    );
    try {
      const before = getOrThrow(await reader.info(context));
      if (before.size > downloadBytes)
        throw new InputError(
          "Downloads are limited to 8 MiB. Ask the bot to split or reduce this file.",
        );
      if (before.size !== entry.bytes || before.mtimeMs !== entry.modifiedAt)
        throw new InputError(
          "Workspace file changed. Refresh before downloading.",
          409,
        );
      const bytes = getOrThrow(await reader.read(0, before.size, context));
      const after = getOrThrow(await reader.info(context));
      if (
        bytes.length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        throw new InputError(
          "Workspace file changed during download. Refresh before downloading.",
          409,
        );
      return { name: entry.name, bytes };
    } finally {
      await reader.close(context);
    }
  }
}
