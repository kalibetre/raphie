import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Resolve once without moving, creating, or merging existing data. */
export function dataDirectory(
  checkout: string,
  configured?: string,
  standalone = false,
) {
  if (configured?.trim()) {
    if (standalone && !isAbsolute(configured))
      throw new Error(
        "DATA_DIRECTORY must be absolute for a standalone binary.",
      );
    return resolve(checkout, configured);
  }
  if (standalone) {
    if (process.platform === "darwin")
      return join(homedir(), "Library", "Application Support", "Raphie");
    if (process.platform === "win32")
      return join(
        process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
        "Raphie",
      );
    const xdg = process.env.XDG_DATA_HOME;
    return join(
      xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share"),
      "raphie",
    );
  }
  checkout = realpathSync(checkout);
  let root = checkout;
  try {
    root = dirname(
      execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        {
          cwd: checkout,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim(),
    );
  } catch {
    if (existsSync(join(checkout, ".git")))
      throw new Error(
        "Could not resolve the Git app data location. Set DATA_DIRECTORY explicitly before starting; no stores were opened.",
      );
  }
  const stable = join(root, ".data");
  const local = join(checkout, ".data");
  if (local !== stable && existsSync(local))
    throw new Error(
      `This checkout has separate data at ${local}. Set DATA_DIRECTORY explicitly to that path or ${stable}. Neither workspace was changed.`,
    );
  return stable;
}
