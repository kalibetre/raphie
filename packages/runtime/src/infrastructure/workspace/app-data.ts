import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Resolve without opening stores. Never copy or combine checkout data. */
export function appDataDirectory(checkout: string, configured?: string) {
  if (configured?.trim()) return resolve(checkout, configured);
  checkout = realpathSync(checkout);
  let root = checkout;
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: checkout,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    root = dirname(common);
  } catch {
    if (existsSync(join(checkout, ".git")))
      throw new Error(
        "Could not resolve the Git app data location. Set DATA_DIRECTORY explicitly before starting; no stores were opened.",
      );
    /* Packaged installations use their installation directory. */
  }
  const stable = join(root, ".data");
  const local = join(checkout, ".data");
  if (local !== stable && existsSync(local))
    throw new Error(
      `This checkout has separate data at ${local}. Set DATA_DIRECTORY explicitly to that path or ${stable}. Neither workspace was changed.`,
    );
  return stable;
}

export async function appDataIdentity(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "workspace-identity.json");
  try {
    await writeFile(path, JSON.stringify({ id: crypto.randomUUID() }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const value = JSON.parse(await readFile(path, "utf8"));
  if (typeof value.id !== "string" || !/^[\da-f-]{36}$/.test(value.id))
    throw new Error(
      "Invalid workspace identity. Restore its backup; do not reset it.",
    );
  return { id: value.id as string, directory: resolve(directory) };
}
