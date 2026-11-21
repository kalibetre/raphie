import { InputError } from "../../../shared/application/input-error.ts";
import { type ArchiveFiles, readTarGz } from "./archives.ts";

/** The most a repository download may be, compressed. */
const DOWNLOAD_LIMIT = 25 * 1024 * 1024;

/** Where in a repository the skills are: `owner/repo`, a ref and a folder. */
export type GitHubSource = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
};

/**
 * Reads a GitHub link to a repository or a folder in it:
 * `https://github.com/owner/repo` or `.../tree/<ref>/<folder>`. A ref with
 * a slash in it cannot be told from a folder, so the first part is the ref.
 */
export function gitHubSource(link: string): GitHubSource {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new InputError("Paste a link to a GitHub repository or folder.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const valid = (part: string | undefined) =>
    !!part && /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..";
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !valid(parts[0]) ||
    !valid(parts[1]) ||
    (parts.length > 2 && parts[2] !== "tree" && parts[2] !== "blob") ||
    parts.slice(3).some((part) => !valid(part))
  )
    throw new InputError(
      "Paste a github.com link to a repository, or to a folder in one.",
    );
  const [owner, repository, , ref, ...path] = parts as string[];
  const folder = parts[2] === "blob" ? path.slice(0, -1) : path;
  return {
    owner: owner!,
    repo: repository!.replace(/\.git$/, ""),
    ref: ref ?? "HEAD",
    path: folder.join("/"),
  };
}

/**
 * The files under the source's folder, downloaded from GitHub's archive of
 * the repository, by their path below that folder. A link to a SKILL.md
 * stands for its folder.
 */
export async function gitHubFiles(
  source: GitHubSource,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveFiles> {
  const url = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${source.ref}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new InputError("Could not reach GitHub. Try again.", 503);
  }
  if (response.status === 404)
    throw new InputError(
      "GitHub has no such public repository or branch.",
      404,
    );
  if (!response.ok)
    throw new InputError(`GitHub answered ${response.status}. Try again.`, 503);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > DOWNLOAD_LIMIT)
    throw new InputError("This repository is too large to import from.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > DOWNLOAD_LIMIT)
    throw new InputError("This repository is too large to import from.");
  // The archive's top folder is named after the repository and commit.
  const prefix = source.path ? `*/${source.path}/` : "*/";
  const archive = await readTarGz(bytes, `${prefix}**`);
  const files: ArchiveFiles = new Map();
  for (const [path, content] of archive) {
    const below = path.split("/").slice(1).join("/");
    const relative = source.path ? below.slice(source.path.length + 1) : below;
    if (relative) files.set(relative, content);
  }
  if (!files.size)
    throw new InputError(`${source.path || "The repository"} holds no files.`);
  return files;
}
